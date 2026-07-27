import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initProvider, loadProvider, runGraphTests, writeTextAtomic } from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("graph test discovery", () => {
  test("does not report an empty test directory as passed", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-empty-tests-"));
    directories.push(directory);
    await initProvider(resolve(directory, "provider"), "empty-tests");
    const provider = await loadProvider(resolve(directory, "provider/provider.yaml"));
    const empty = resolve(directory, "empty");
    await mkdir(empty);
    await expect(runGraphTests(provider, empty)).rejects.toMatchObject({ code: "test-cases-empty" });
  });

  test("asserts phase-local Gate Action Skills", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-gate-skill-test-"));
    directories.push(directory);
    const root = resolve(directory, "provider");
    await initProvider(root, "gate-skill-test");
    await writeTextAtomic(resolve(root, "graphs/main.yaml"), `schema: agent-graph.graph.v1
id: main
entrypoints: { default: review }
nodes:
  - id: review
    kind: gate
    reasonCode: route.main.work
    gate: { id: review, prompt: Review the result. }
    inspectionAction: actions/inspect.yaml
    resolutionAction: actions/apply.yaml
  - { id: done, kind: terminal, terminalOutcome: completed }
edges: [{ from: review, to: done, outcomes: [completed] }]
`);
    await writeTextAtomic(resolve(root, "actions/inspect.yaml"), `schema: agent-graph.action.v1
id: inspect
runner: agent
effect: read
skill: skills/inspect/SKILL.md
`);
    await writeTextAtomic(resolve(root, "actions/apply.yaml"), `schema: agent-graph.action.v1
id: apply
runner: agent
effect: write
skill: skills/apply/SKILL.md
`);
    await writeTextAtomic(resolve(root, "skills/inspect/SKILL.md"), `---
name: inspect-result
description: Inspect the result.
---
`);
    await writeTextAtomic(resolve(root, "skills/apply/SKILL.md"), `---
name: apply-review
description: Apply the review.
---
`);
    const testPath = resolve(root, "tests/gate-skills.yaml");
    await writeTextAtomic(testPath, `schema: agent-graph.test.v1
name: gate action skills stay phase-local
graph: main
entry: default
expect:
  statusCode: waiting-user
  inspectionSkill: skill.inspect-result
  resolutionSkill: skill.apply-review
`);
    const provider = await loadProvider(resolve(root, "provider.yaml"));
    expect((await runGraphTests(provider, testPath))[0]?.passed).toBe(true);

    await writeTextAtomic(testPath, `schema: agent-graph.test.v1
name: reports a mismatched gate action skill
graph: main
entry: default
expect:
  statusCode: waiting-user
  resolutionSkill: skill.wrong
`);
    const failed = (await runGraphTests(provider, testPath))[0];
    expect(failed?.passed).toBe(false);
    expect(failed?.failures[0]).toContain("resolutionSkill");
  });
});
