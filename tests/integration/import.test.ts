import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AgentGraphError, importScripts, importSkill, importWorkflow, initProvider, loadProvider, writeTextAtomic } from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("legacy imports", () => {
  test("converts Skills, scripts, and dependency workflows into valid provider graphs", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-import-"));
    directories.push(directory);
    await initProvider(directory, "import-test");
    const examples = resolve(import.meta.dir, "../../examples");
    await importSkill(resolve(examples, "simple-skill/skills/draft/SKILL.md"), directory, "imported-skill");
    await importScripts([
      resolve(examples, "importing/scripts/inspect.sh"),
      resolve(examples, "importing/scripts/package.sh"),
    ], directory, "imported-scripts");
    await importWorkflow(resolve(examples, "importing/legacy-workflow.yaml"), directory);
    const provider = await loadProvider(resolve(directory, "provider.yaml"));
    expect([...provider.graphs.keys()].sort()).toEqual(["main", "imported-release", "imported-scripts", "imported-skill"].sort());
    expect(provider.codeCatalog?.entries.has("route.imported-skill.use-skill")).toBe(true);
    expect(provider.codeCatalog?.entries.has("route.imported-scripts.step-1")).toBe(true);
    expect(provider.codeCatalog?.entries.has("route.imported-release.start")).toBe(true);
    const report = await readFile(resolve(directory, "IMPORT_REPORT.md"), "utf8");
    expect(report).toContain("## Skill imported-skill");
    expect(report).toContain("## Scripts imported-scripts");
    expect(report).toContain("## Workflow imported-release");
    try {
      await importWorkflow(resolve(examples, "importing/legacy-workflow.yaml"), directory);
      throw new Error("expected import to refuse replacement");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentGraphError);
      expect((error as AgentGraphError).code).toBe("import-target-exists");
    }
  });

  test("rejects cyclic workflow dependencies before changing the Provider", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-import-cycle-"));
    directories.push(directory);
    await initProvider(directory, "import-cycle");
    const workflow = resolve(directory, "cycle.yaml");
    await writeTextAtomic(workflow, `id: cyclic
steps:
  - { id: first, command: "true", dependsOn: [second] }
  - { id: second, command: "true", dependsOn: [first] }
`);
    await expect(importWorkflow(workflow, directory)).rejects.toMatchObject({ code: "workflow-cycle" });
    const provider = await loadProvider(resolve(directory, "provider.yaml"));
    expect([...provider.graphs.keys()]).toEqual(["main"]);
  });

  test("normalizes requested import ids without allowing path traversal", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-import-path-"));
    directories.push(directory);
    await initProvider(directory, "import-path");
    const script = resolve(import.meta.dir, "../../examples/importing/scripts/inspect.sh");
    const graph = await importScripts([script], directory, "../../outside");
    expect(graph).toBe(resolve(directory, "graphs/outside.yaml"));
    expect(await loadProvider(resolve(directory, "provider.yaml"))).toBeDefined();
  });
});
