import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evaluateGraph, loadProvider, materializeResource, writeTextAtomic } from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function providerWithMaterializer(script: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-materializer-"));
  directories.push(directory);
  await cp(resolve(import.meta.dir, "../../examples/dynamic-resource"), directory, { recursive: true });
  await writeTextAtomic(resolve(directory, "scripts/context.mjs"), script);
  return { directory, provider: await loadProvider(resolve(directory, "provider.yaml")) };
}

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

  test("terminates a materializer that exceeds its runtime limit", async () => {
    const { directory, provider } = await providerWithMaterializer("setInterval(() => {}, 1000);\n");
    const revision = evaluateGraph(provider, "diagnose").evaluation.revision;
    await expect(materializeResource(provider, "context.current", {
      cache: resolve(directory, "cache"),
      workspace: directory,
      revision,
      timeoutMs: 50,
    })).rejects.toMatchObject({ code: "materializer-timeout" });
  });

  test("terminates a materializer that exceeds its stdout limit", async () => {
    const { directory, provider } = await providerWithMaterializer('process.stdout.write("x".repeat(64));\n');
    const revision = evaluateGraph(provider, "diagnose").evaluation.revision;
    await expect(materializeResource(provider, "context.current", {
      cache: resolve(directory, "cache"),
      workspace: directory,
      revision,
      maxOutputBytes: 16,
    })).rejects.toMatchObject({ code: "materializer-output-limit" });
  });

  test("inherits only a minimal environment unless the host explicitly adds variables", async () => {
    const secretKey = "AGENT_GRAPH_TEST_SECRET";
    const previous = process.env[secretKey];
    process.env[secretKey] = "host-secret";
    try {
      const { directory, provider } = await providerWithMaterializer(
        `process.stdout.write(JSON.stringify({ secret: process.env.${secretKey} ?? null }));\n`,
      );
      const revision = evaluateGraph(provider, "diagnose").evaluation.revision;
      const isolated = await materializeResource(provider, "context.current", {
        cache: resolve(directory, "isolated"),
        workspace: directory,
        revision,
      });
      expect(JSON.parse(await readFile(isolated.filePath!, "utf8")).secret).toBeNull();

      const optedIn = await materializeResource(provider, "context.current", {
        cache: resolve(directory, "opted-in"),
        workspace: directory,
        revision,
        env: { [secretKey]: "explicit-value" },
      });
      expect(JSON.parse(await readFile(optedIn.filePath!, "utf8")).secret).toBe("explicit-value");
    } finally {
      if (previous === undefined) delete process.env[secretKey];
      else process.env[secretKey] = previous;
    }
  });
});
