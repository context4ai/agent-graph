import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

let directory = "";
const root = resolve(import.meta.dir, "../..");

function execute(command: string, args: string[], cwd = root) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
}

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "agent-graph-cli-"));
  const build = execute(process.execPath, ["run", "build"]);
  if (build.status !== 0) throw new Error(build.stderr || build.stdout);
});

afterAll(async () => rm(directory, { recursive: true, force: true }));

describe("built CLI", () => {
  test("runs as a Node executable and as a standalone copied file", async () => {
    const version = execute("node", ["dist/agent-graph.mjs", "--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe("0.2.4");
    const standalone = resolve(directory, "agent-graph.mjs");
    await Bun.write(standalone, Bun.file(resolve(root, "dist/agent-graph.mjs")));
    await chmod(standalone, 0o755);
    const validate = execute("node", [standalone, "--manifest", resolve(root, "examples/simple-skill/provider.yaml"), "validate", "--format", "json"], directory);
    expect(validate.status).toBe(0);
    expect(JSON.parse(validate.stdout).state).toBe("valid");
    const bunVersion = execute(process.execPath, [standalone, "--version"], directory);
    expect(bunVersion.status).toBe(0);
    expect(bunVersion.stdout.trim()).toBe("0.2.4");
    const extracted = resolve(directory, "graph.schema.json");
    const schema = execute("node", [standalone, "schema", "extract", "graph", "--output", extracted, "--format", "json"], directory);
    expect(schema.status).toBe(0);
    expect(JSON.parse(await readFile(extracted, "utf8")).title).toBe("Agent Graph Definition");
  });

  test("initializes, evaluates, records, resumes, tests, and builds without a fixed runtime directory", async () => {
    const providerRoot = resolve(directory, "provider");
    const state = resolve(directory, "state/run.json");
    const checkpoint = resolve(directory, "state/checkpoint.json");
    const resumed = resolve(directory, "state/resumed.json");
    const cli = resolve(root, "dist/agent-graph.mjs");
    expect(execute("node", [cli, "init", providerRoot, "--id", "cli-test", "--format", "json"]).status).toBe(0);
    const manifest = resolve(providerRoot, "provider.yaml");
    expect(await readFile(manifest, "utf8")).toContain("agentGraph: ^0.2.0");
    expect(execute("node", [cli, "--manifest", manifest, "validate", "--format", "json"]).status).toBe(0);
    expect(execute("node", [cli, "--manifest", manifest, "test", resolve(providerRoot, "tests"), "--format", "json"]).status).toBe(0);
    expect(execute("node", [cli, "--manifest", manifest, "run", "start", "main", "--state", state, "--workspace", providerRoot, "--format", "json"]).status).toBe(0);
    const route = execute("node", [cli, "--manifest", manifest, "route", "main", "--state", state, "--format", "json"]);
    expect(route.status).toBe(0);
    const routePayload = JSON.parse(route.stdout) as {
      revision: string;
      routeId: string;
      afterAction: { recordNode: string };
      resources: { required: Array<{ id: string; digest: string; readState: string }> };
    };
    expect(routePayload.resources.required.every((resource) => resource.readState === "read-required")).toBe(true);
    const receipts = resolve(directory, "resource-read-receipts.json");
    await Bun.write(receipts, JSON.stringify({
      schema: "agent-graph.resource-read-receipts.v1",
      provider: "cli-test",
      receipts: routePayload.resources.required.map((resource) => ({ id: resource.id, digest: resource.digest })),
    }));
    const reused = execute("node", [
      cli,
      "--manifest", manifest,
      "route", "main", routePayload.routeId,
      "--state", state,
      "--revision", routePayload.revision,
      "--resource-receipts", `@${receipts}`,
      "--format", "json",
    ]);
    expect(reused.status).toBe(0);
    expect(JSON.parse(reused.stdout).resources.required.every(
      (resource: { readState: string }) => resource.readState === "current",
    )).toBe(true);
    const recordNode = routePayload.afterAction.recordNode;
    expect(execute("node", [cli, "run", "record", recordNode, "completed", "--state", state, "--format", "json"]).status).toBe(0);
    expect(execute("node", [cli, "run", "checkpoint", "--state", state, "--to", checkpoint, "--format", "json"]).status).toBe(0);
    expect(execute("node", [cli, "run", "resume", checkpoint, "--state", resumed, "--format", "json"]).status).toBe(0);
    expect(execute("node", [cli, "--manifest", manifest, "build", resolve(directory, "bundle"), "--format", "json"]).status).toBe(0);
  });

  test("combines an explicit Run with authority granted for the current invocation", () => {
    const cli = resolve(root, "dist/agent-graph.mjs");
    const manifest = resolve(root, "examples/shared-provider/provider.yaml");
    const state = resolve(directory, "authority-run.json");
    expect(execute("node", [cli, "--manifest", manifest, "run", "start", "release", "--state", state, "--format", "json"]).status).toBe(0);
    expect(execute("node", [cli, "run", "record", "release/inspect", "completed", "--state", state, "--format", "json"]).status).toBe(0);
    const route = execute("node", [cli, "--manifest", manifest, "route", "release", "--state", state, "--authority", "release.approve", "--format", "json"]);
    expect(route.status).toBe(0);
    expect(JSON.parse(route.stdout).gate.resolution).toBe("session-authority");
  });

  test("accepts stateless outcomes without requiring a Run file", () => {
    const cli = resolve(root, "dist/agent-graph.mjs");
    const manifest = resolve(root, "examples/shared-provider/provider.yaml");
    const evaluated = execute("node", [
      cli,
      "--manifest", manifest,
      "evaluate", "release",
      "--outcomes", JSON.stringify({ "release/inspect": "completed" }),
      "--format", "json",
    ]);
    expect(evaluated.status).toBe(0);
    expect(JSON.parse(evaluated.stdout).primaryRoute.node).toBe("approval");
  });

  test("uses a complete Skill binding and discovers reason-code documents", () => {
    const cli = resolve(root, "dist/agent-graph.mjs");
    const skill = resolve(root, "examples/shared-provider/skills/release/SKILL.md");
    const evaluated = execute("node", [cli, "--skill", skill, "evaluate", "--format", "json"]);
    expect(evaluated.status).toBe(0);
    const evaluation = JSON.parse(evaluated.stdout);
    expect(evaluation.primaryRoute.reasonCode).toBe("route.release.inspect");
    const routed = execute("node", [
      cli,
      "--skill", skill,
      "route", evaluation.primaryRoute.routeId,
      "--revision", evaluation.revision,
      "--format", "json",
    ]);
    expect(routed.status).toBe(0);
    expect(JSON.parse(routed.stdout).graph).toBe("release");

    const manifest = resolve(root, "examples/shared-provider/provider.yaml");
    const located = execute("node", [
      cli,
      "--manifest", manifest,
      "code", "locate", "route.release.inspect",
      "--format", "json",
    ]);
    expect(located.status).toBe(0);
    expect(JSON.parse(located.stdout).document.id).toBe("release.checklist");
  });

  test("returns a schema-versioned JSON error envelope", () => {
    const cli = resolve(root, "dist/agent-graph.mjs");
    const manifest = resolve(root, "examples/simple-skill/provider.yaml");
    const failed = execute("node", [cli, "--manifest", manifest, "evaluate", "missing", "--format", "json"]);
    expect(failed.status).toBe(1);
    const envelope = JSON.parse(failed.stderr);
    expect(envelope.schema).toBe("agent-graph.error.v1");
    expect(envelope.error.code).toBe("graph-missing");
  });

  test("binds a materialized context view to its selecting route revision", () => {
    const cli = resolve(root, "dist/agent-graph.mjs");
    const manifest = resolve(root, "examples/dynamic-resource/provider.yaml");
    const evaluated = execute("node", [cli, "--manifest", manifest, "evaluate", "diagnose", "--format", "json"]);
    expect(evaluated.status).toBe(0);
    const evaluation = JSON.parse(evaluated.stdout) as { revision: string };
    const cache = resolve(directory, "materialized");
    const materialized = execute("node", [
      cli,
      "--manifest", manifest,
      "resource", "materialize", "context.current",
      "--cache", cache,
      "--workspace", directory,
      "--revision", evaluation.revision,
      "--timeout-ms", "5000",
      "--max-output-bytes", "4096",
      "--max-error-bytes", "4096",
      "--format", "json",
    ]);
    expect(materialized.status).toBe(0);
    expect(JSON.parse(materialized.stdout).revision).toBe(evaluation.revision);
  });
});
