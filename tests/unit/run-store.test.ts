import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  checkpointRun,
  createRun,
  loadRun,
  recordOutcome,
  resumeRun,
  updateRunAuthorities,
  updateRunFacts,
} from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("explicit run state", () => {
  test("records facts, outcomes, authorities, checkpoints, and resume events", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-run-"));
    directories.push(directory);
    const statePath = resolve(directory, "run.json");
    const checkpoint = resolve(directory, "checkpoint.json");
    const resumed = resolve(directory, "resumed.json");
    await createRun(statePath, { provider: "test", graph: "main", workspace: directory });
    await expect(createRun(statePath, { provider: "other", graph: "other" })).rejects.toMatchObject({ code: "run-target-exists" });
    await updateRunFacts(statePath, { ready: true });
    await updateRunAuthorities(statePath, ["review.approve"]);
    await recordOutcome(statePath, "main/work", "completed", { receipt: "ok" });
    await checkpointRun(statePath, checkpoint);
    expect((await loadRun(checkpoint)).authorities).toEqual([]);
    await expect(checkpointRun(statePath, checkpoint)).rejects.toMatchObject({ code: "run-target-exists" });
    await resumeRun(checkpoint, resumed);
    await expect(resumeRun(checkpoint, resumed)).rejects.toMatchObject({ code: "run-target-exists" });
    const run = await loadRun(resumed);
    expect(run.facts.ready).toBe(true);
    expect(run.outcomes["main/work"]?.outcome).toBe("completed");
    expect(run.authorities).toEqual([]);
    expect(run.events.at(-1)?.type).toBe("run.resumed");
  });
});
