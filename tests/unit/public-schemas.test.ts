import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildProviderBundle,
  evaluateGraph,
  loadProvider,
  locateCode,
  locateResource,
  resolveSkillBinding,
  resolveRoute,
  schemaTypes,
  validateSchema,
} from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("public output schemas", () => {
  test("rejects route reasons outside the neutral route namespace", async () => {
    await expect(validateSchema("graph", {
      schema: "agent-graph.graph.v1",
      id: "invalid-reason",
      entrypoints: { default: "work" },
      nodes: [
        {
          id: "work",
          kind: "action",
          action: "actions/work.yaml",
          reasonCode: "product.work-ready",
        },
        { id: "done", kind: "terminal", terminalOutcome: "completed" },
      ],
      edges: [{ from: "work", to: "done", outcomes: ["completed"] }],
    }, "invalid-reason")).rejects.toMatchObject({ code: "schema-invalid" });
  });

  test("catalogs and validates evaluation, route, resource location, and bundle outputs", async () => {
    expect(schemaTypes()).toEqual([
      "action",
      "bundle",
      "code-catalog",
      "code-location",
      "error",
      "evaluation",
      "graph",
      "provider",
      "resource",
      "resource-location",
      "route",
      "run",
      "skill-binding",
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

    const catalogProvider = await loadProvider(resolve(import.meta.dir, "../../examples/shared-provider/provider.yaml"));
    await validateSchema("code-catalog", catalogProvider.codeCatalog!.definition, "code-catalog");
    const code = await locateCode(catalogProvider, "route.release.inspect");
    await validateSchema("code-location", code, "code-location");
    expect(code.document?.id).toBe("release.checklist");
    await validateSchema("error", {
      schema: "agent-graph.error.v1",
      state: "error",
      error: {
        code: "example-error",
        message: "Example failure.",
        diagnostics: [],
      },
    }, "error");
    const binding = await resolveSkillBinding(resolve(
      import.meta.dir,
      "../../examples/shared-provider/skills/release/SKILL.md",
    ));
    await validateSchema("skill-binding", binding, "skill-binding");

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
    const dynamicResource = dynamicRoute.resources.required.find((item) => item.kind === "context-view");
    expect(dynamicResource?.revision).toBe(dynamicEvaluation.revision);
    expect(dynamicResource?.materialize).toEqual({ resourceId: "context.current" });
    expect(dynamicResource?.filePath).toBeUndefined();
  });
});
