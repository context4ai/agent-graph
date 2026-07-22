import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildProviderBundle,
  evaluateGraph,
  loadProvider,
  locateResource,
  resolveRoute,
  schemaTypes,
  validateSchema,
} from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("public output schemas", () => {
  test("catalogs and validates evaluation, route, resource location, and bundle outputs", async () => {
    expect(schemaTypes()).toEqual([
      "action",
      "bundle",
      "evaluation",
      "graph",
      "provider",
      "resource",
      "resource-location",
      "route",
      "run",
      "test-case",
    ]);
    const provider = await loadProvider(resolve(import.meta.dir, "../../examples/simple-skill/provider.yaml"));
    const evaluation = evaluateGraph(provider, "main").evaluation;
    await validateSchema("evaluation", evaluation, "evaluation");
    const route = await resolveRoute(provider, "main", "default", evaluation.primaryRoute!.routeId);
    await validateSchema("route", route, "route");
    const resource = await locateResource(provider, "procedure.drafting");
    await validateSchema("resource-location", resource, "resource-location");
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-schema-"));
    directories.push(directory);
    const bundle = await buildProviderBundle(provider, resolve(directory, "bundle"));
    await validateSchema("bundle", bundle, "bundle");

    const dynamicProvider = await loadProvider(resolve(import.meta.dir, "../../examples/dynamic-resource/provider.yaml"));
    const dynamicEvaluation = evaluateGraph(dynamicProvider, "diagnose").evaluation;
    const dynamicRoute = await resolveRoute(
      dynamicProvider,
      "diagnose",
      "default",
      dynamicEvaluation.primaryRoute!.routeId,
      {},
      dynamicEvaluation.revision,
    );
    await validateSchema("route", dynamicRoute, "dynamic-route");
    expect(dynamicRoute.resources.required.find((item) => item.kind === "context-view")?.revision).toBe(dynamicEvaluation.revision);
  });
});
