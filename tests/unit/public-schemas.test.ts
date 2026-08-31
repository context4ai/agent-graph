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
      "host-action-result",
      "provider",
      "resource",
      "resource-location",
      "resource-read-receipts",
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
    expect(resource.schema).toBe("agent-graph.resource-location.file.v1");
    await validateSchema("resource-location", resource, "resource-location");
    await validateSchema("resource-read-receipts", {
      schema: "agent-graph.resource-read-receipts.v1",
      provider: provider.manifest.id,
      receipts: [{ id: resource.id, digest: resource.digest }],
    }, "resource-read-receipts");
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
    expect(dynamicResource?.schema).toBe("agent-graph.resource-location.graph-action.v1");
    if (dynamicResource?.schema !== "agent-graph.resource-location.graph-action.v1") {
      throw new Error("Expected a Graph-action resource location");
    }
    expect(dynamicResource?.revision).toBe(dynamicEvaluation.revision);
    expect(dynamicResource?.materialize).toEqual({ resourceId: "context.current" });
    expect(dynamicResource?.filePath).toBeUndefined();

    const hostProvider = await loadProvider(resolve(
      import.meta.dir,
      "../../examples/host-materialized-resource/provider.yaml",
    ));
    const hostEvaluation = evaluateGraph(hostProvider, "main").evaluation;
    const hostRoute = await resolveRoute(
      hostProvider,
      "main",
      "default",
      hostEvaluation.primaryRoute!.routeId,
      {},
      hostEvaluation.revision,
    );
    await validateSchema("route", hostRoute, "host-route");
    const hostResource = hostRoute.resources.required.find((item) => item.id === "resolved.instructions");
    expect(hostResource?.schema).toBe("agent-graph.resource-location.host-action.v1");
    if (hostResource?.schema !== "agent-graph.resource-location.host-action.v1") {
      throw new Error("Expected a host-action resource location");
    }
    expect(hostResource.materialize).toMatchObject({
      handler: "example.materialize-resolved-instructions/v1",
      input: {
        schema: "example.materialize-request/v1",
        value: { resource_ref: "instructions:current" },
      },
      output_schema: "example.materialized-resource/v1",
    });
    await validateSchema("resource-location", hostResource, "host-resource-location");
  });

  test("rejects the removed numeric Resource protocol identifiers", async () => {
    await expect(validateSchema("resource", {
      schema: "agent-graph.resource.v1",
      id: "legacy.resource",
      kind: "schema",
      mediaType: "application/json",
      path: "legacy.json",
    }, "legacy-resource")).rejects.toMatchObject({ code: "schema-invalid" });
    await expect(validateSchema("resource-location", {
      schema: "agent-graph.resource-location.v2",
      id: "legacy.location",
      kind: "procedure",
      mediaType: "text/markdown",
      materialize: {
        handler: "example.materialize/v1",
        input: { schema: "example.input/v1", value: {} },
        output_schema: "example.output/v1",
      },
    }, "legacy-resource-location")).rejects.toMatchObject({ code: "schema-invalid" });
  });
});
