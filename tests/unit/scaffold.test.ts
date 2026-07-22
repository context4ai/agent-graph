import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initProvider, writeTextAtomic } from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("provider scaffolding", () => {
  test("refuses to replace any generated target", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-init-"));
    directories.push(directory);
    const existing = resolve(directory, "graphs/main.yaml");
    await writeTextAtomic(existing, "user-owned\n");
    await expect(initProvider(directory, "safe-init")).rejects.toMatchObject({ code: "provider-target-exists" });
    expect(await readFile(existing, "utf8")).toBe("user-owned\n");
  });
});
