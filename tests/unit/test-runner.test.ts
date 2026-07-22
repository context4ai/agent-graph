import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initProvider, loadProvider, runGraphTests } from "../../src/index.js";

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
});
