import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AgentGraphError, computeRevision, initProvider, loadProvider, resolveSkillManifest, writeTextAtomic } from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("provider loading", () => {
  test("rejects cross-graph recursion", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-cycle-"));
    directories.push(directory);
    await initProvider(directory, "cycle-test");
    await writeTextAtomic(resolve(directory, "provider.yaml"), `schema: agent-graph.provider.v1\nid: cycle-test\nversion: 0.1.0\ngraphs: [graphs/a.yaml, graphs/b.yaml]\n`);
    await writeTextAtomic(resolve(directory, "graphs/a.yaml"), `schema: agent-graph.graph.v1\nid: a\nentrypoints: { default: child }\nnodes: [{ id: child, kind: subgraph, graph: b, entry: default }]\nedges: []\n`);
    await writeTextAtomic(resolve(directory, "graphs/b.yaml"), `schema: agent-graph.graph.v1\nid: b\nentrypoints: { default: child }\nnodes: [{ id: child, kind: subgraph, graph: a, entry: default }]\nedges: []\n`);
    try {
      await loadProvider(resolve(directory, "provider.yaml"));
      throw new Error("expected recursion rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentGraphError);
      expect((error as AgentGraphError).code).toBe("graph-recursion");
    }
  });

  test("rejects implicit flow cycles and requires repeat edges for loops", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-flow-cycle-"));
    directories.push(directory);
    await initProvider(directory, "flow-cycle-test");
    await writeTextAtomic(resolve(directory, "graphs/main.yaml"), `schema: agent-graph.graph.v1
id: main
entrypoints: { default: first }
nodes:
  - { id: first, kind: action, action: actions/work.yaml }
  - { id: second, kind: action, action: actions/work.yaml }
edges:
  - { from: first, to: second, outcomes: [completed] }
  - { from: second, to: first, outcomes: [completed] }
`);
    await expect(loadProvider(resolve(directory, "provider.yaml"))).rejects.toMatchObject({ code: "graph-flow-cycle" });
  });

  test("rejects a write action reused as a dynamic resource materializer", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-materializer-"));
    directories.push(directory);
    await initProvider(directory, "materializer-test");
    await writeTextAtomic(resolve(directory, "graphs/main.yaml"), `schema: agent-graph.graph.v1
id: main
entrypoints: { default: work }
nodes:
  - id: work
    kind: action
    action: actions/work.yaml
    resources:
      required: [resources/view.yaml]
  - { id: done, kind: terminal, terminalOutcome: completed }
edges: [{ from: work, to: done, outcomes: [completed] }]
`);
    await writeTextAtomic(resolve(directory, "resources/view.yaml"), `schema: agent-graph.resource.v1
id: context.view
kind: context-view
mediaType: text/markdown
materializer: actions/work.yaml
`);
    await expect(loadProvider(resolve(directory, "provider.yaml"))).rejects.toMatchObject({ code: "materializer-effect-invalid" });
  });

  test("scopes routing revisions to the selected graph dependency closure", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-revision-scope-"));
    directories.push(directory);
    await initProvider(directory, "revision-scope");
    await writeTextAtomic(resolve(directory, "provider.yaml"), `schema: agent-graph.provider.v1
id: revision-scope
version: 0.1.0
graphs: [graphs/main.yaml, graphs/other.yaml]
`);
    await writeTextAtomic(resolve(directory, "graphs/other.yaml"), `schema: agent-graph.graph.v1
id: other
entrypoints: { default: work }
nodes:
  - { id: work, kind: action, action: actions/other.yaml }
  - { id: done, kind: terminal, terminalOutcome: completed }
edges: [{ from: work, to: done, outcomes: [completed] }]
`);
    await writeTextAtomic(resolve(directory, "actions/other.yaml"), `schema: agent-graph.action.v1
id: other
runner: command
effect: read
command: "true"
`);
    const first = await loadProvider(resolve(directory, "provider.yaml"));
    const mainRevision = computeRevision(first, "main", "default", {});
    const otherRevision = computeRevision(first, "other", "default", {});

    await writeTextAtomic(resolve(directory, "actions/other.yaml"), `schema: agent-graph.action.v1
id: other
runner: command
effect: read
command: "printf changed"
`);
    const afterUnrelatedChange = await loadProvider(resolve(directory, "provider.yaml"));
    expect(computeRevision(afterUnrelatedChange, "main", "default", {})).toBe(mainRevision);
    expect(computeRevision(afterUnrelatedChange, "other", "default", {})).not.toBe(otherRevision);

    await writeTextAtomic(resolve(directory, "resources/procedure.md"), `---
id: procedure.start
kind: procedure
media-type: text/markdown
---

Changed procedure.
`);
    const afterRelatedChange = await loadProvider(resolve(directory, "provider.yaml"));
    expect(computeRevision(afterRelatedChange, "main", "default", {})).not.toBe(mainRevision);
  });

  test("rejects non-portable absolute Skill locators", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-skill-locator-"));
    directories.push(directory);
    const skill = resolve(directory, "SKILL.md");
    await writeTextAtomic(skill, `---
name: invalid-locator
description: Invalid absolute locator fixture.
metadata:
  agent-graph: path:/tmp/provider.yaml
---
`);
    await expect(resolveSkillManifest(skill)).rejects.toMatchObject({ code: "skill-locator-absolute" });
  });

  test("rejects runner fields with ambiguous execution semantics", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-action-shape-"));
    directories.push(directory);
    await initProvider(directory, "action-shape");
    await writeTextAtomic(resolve(directory, "actions/work.yaml"), `schema: agent-graph.action.v1
id: work
runner: command
effect: read
command: "true"
skill: skills/getting-started/SKILL.md
`);
    await expect(loadProvider(resolve(directory, "provider.yaml"))).rejects.toMatchObject({ code: "schema-invalid" });
  });

  test("rejects gatedBy edges that do not originate at a gate", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-gate-edge-"));
    directories.push(directory);
    await initProvider(directory, "gate-edge");
    await writeTextAtomic(resolve(directory, "graphs/main.yaml"), `schema: agent-graph.graph.v1
id: main
entrypoints: { default: work }
nodes:
  - { id: work, kind: action, action: actions/work.yaml }
  - { id: done, kind: terminal, terminalOutcome: completed }
edges: [{ from: work, to: done, kind: gatedBy, outcomes: [completed] }]
`);
    await expect(loadProvider(resolve(directory, "provider.yaml"))).rejects.toMatchObject({ code: "graph-gated-by-source-invalid" });
  });

  test("rejects Provider references that escape through a symbolic link", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-symlink-root-"));
    const outside = await mkdtemp(resolve(tmpdir(), "agent-graph-symlink-outside-"));
    directories.push(directory, outside);
    await initProvider(directory, "symlink-root");
    const externalAction = resolve(outside, "work.yaml");
    await writeTextAtomic(externalAction, `schema: agent-graph.action.v1
id: work
runner: command
effect: read
command: "true"
`);
    const actionPath = resolve(directory, "actions/work.yaml");
    await rm(actionPath);
    await symlink(externalAction, actionPath);
    await expect(loadProvider(resolve(directory, "provider.yaml"))).rejects.toMatchObject({ code: "path-symlink-outside-provider" });
  });
});
