import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evaluateGraph, loadProvider, materializeResource } from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("dynamic resources", () => {
  test("materializes only into a host-selected cache with a content digest", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-resource-"));
    directories.push(directory);
    const provider = await loadProvider(resolve(import.meta.dir, "../../examples/dynamic-resource/provider.yaml"));
    const revision = evaluateGraph(provider, "diagnose").evaluation.revision;
    const location = await materializeResource(provider, "context.current", {
      cache: resolve(directory, "cache"),
      workspace: directory,
      revision,
      input: { scope: "unit" },
    });
    const content = JSON.parse(await readFile(location.filePath!, "utf8")) as {
      workspace: string;
      revision: string;
      input: { scope: string };
    };
    expect(content.workspace).toBe(directory);
    expect(content.revision).toBe(revision);
    expect(content.input.scope).toBe("unit");
    expect(location.digest).toStartWith("sha256:");
    expect(location.revision).toBe(revision);
    const receipt = JSON.parse(await readFile(resolve(directory, "cache", `${location.digest!.slice("sha256:".length)}.receipt.json`), "utf8"));
    expect(receipt.revision).toBe(revision);
  });
});
