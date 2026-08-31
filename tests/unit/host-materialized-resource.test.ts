import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  checkpointRun,
  createRun,
  evaluateGraph,
  hostActionInputDigest,
  hostActionOutputDigest,
  hostActionResourceReadReceipt,
  loadProvider,
  loadRun,
  readStructuredFile,
  resolveRoute,
  resumeRun,
  updateRunFacts,
  validateHostActionResult,
  validateSchemaDocument,
  writeTextAtomic,
} from "../../src/index.js";
import type {
  HostActionResult,
  HostActionResourceLocation,
  JsonValue,
  LoadedProvider,
  ResourceReadReceiptSet,
} from "../../src/types.js";

const directories: string[] = [];
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

afterEach(async () => Promise.all(
  directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
));

async function copiedProvider(): Promise<{ directory: string; provider: LoadedProvider }> {
  const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-host-resource-"));
  directories.push(directory);
  await cp(resolve(import.meta.dir, "../../examples/host-materialized-resource"), directory, { recursive: true });
  return { directory, provider: await loadProvider(resolve(directory, "provider.yaml")) };
}

async function hostLocation(provider: LoadedProvider): Promise<{
  location: HostActionResourceLocation;
  revision: string;
  routeId: string;
}> {
  const evaluation = evaluateGraph(provider, "main").evaluation;
  const route = await resolveRoute(
    provider,
    "main",
    "default",
    evaluation.primaryRoute!.routeId,
    {},
    evaluation.revision,
  );
  const location = route.resources.required.find((resource) => resource.id === "resolved.instructions");
  if (location?.schema !== "agent-graph.resource-location.host-action.v1") {
    throw new Error("Expected a host-action resource location");
  }
  return { location, revision: evaluation.revision, routeId: evaluation.primaryRoute!.routeId };
}

function inlineResult(location: HostActionResourceLocation): HostActionResult {
  return {
    schema: "agent-graph.host-action-result.v1",
    handler: location.materialize.handler,
    input_digest: hostActionInputDigest(location),
    output: {
      schema: location.materialize.output_schema,
      inline: {
        schema: "example.materialized-resource/v1",
        content: "resolved instructions",
      },
    },
    receipt: {
      adapter: "example.host-adapter",
      adapter_version: "1.2.3",
    },
  };
}

describe("host-materialized resource ABI", () => {
  test("validates a canonical input and inline output before producing a read receipt", async () => {
    const { provider } = await copiedProvider();
    const { location } = await hostLocation(provider);
    const result = inlineResult(location);

    await validateHostActionResult(location, result);
    if (!("inline" in result.output)) throw new Error("Expected inline output");
    const outputSchema = await readStructuredFile<object>(resolve(
      provider.root,
      "schemas/materialized-resource.schema.json",
    ));
    validateSchemaDocument(outputSchema, result.output.inline, "inline host output");
    expect(() => validateSchemaDocument(outputSchema, { content: "missing discriminator" }, "invalid host output"))
      .toThrow("invalid host output does not match its referenced schema");
    const serialized = JSON.parse(JSON.stringify(result)) as HostActionResult;
    expect(await hostActionResourceReadReceipt(location, serialized)).toEqual({
      id: location.id,
      digest: hostActionOutputDigest(result),
      revision: location.revision,
    });

    await expect(validateHostActionResult(location, { ...result, handler: "example.other/v1" }))
      .rejects.toMatchObject({ code: "host-action-handler-mismatch" });
    await expect(validateHostActionResult(location, { ...result, input_digest: DIGEST_A }))
      .rejects.toMatchObject({ code: "host-action-input-stale" });
    await expect(validateHostActionResult(location, {
      ...result,
      output: { ...result.output, schema: "example.other-output/v1" },
    })).rejects.toMatchObject({ code: "host-action-output-schema-mismatch" });
  });

  test("uses a strict inline or managed-resource output union", async () => {
    const { provider } = await copiedProvider();
    const { location } = await hostLocation(provider);
    const inline = inlineResult(location);
    const resource: HostActionResult = {
      ...inline,
      output: {
        schema: location.materialize.output_schema,
        resource: { ref: "host-resource://example/instructions", digest: DIGEST_B },
      },
    };
    await validateHostActionResult(location, resource);
    expect(hostActionOutputDigest(resource)).toBe(DIGEST_B);
    expect((await hostActionResourceReadReceipt(location, resource)).digest).toBe(DIGEST_B);

    await expect(validateHostActionResult(location, {
      ...inline,
      output: {
        schema: location.materialize.output_schema,
        inline: {},
        resource: { ref: "host-resource://example/instructions", digest: DIGEST_B },
      },
    } as HostActionResult)).rejects.toMatchObject({ code: "schema-invalid" });
    await expect(validateHostActionResult(location, {
      ...resource,
      output: {
        schema: location.materialize.output_schema,
        resource: { digest: DIGEST_B },
      },
    } as HostActionResult)).rejects.toMatchObject({ code: "schema-invalid" });
  });

  test("persists a validated result through checkpoint recovery without changing its correlation", async () => {
    const { directory, provider } = await copiedProvider();
    const { location } = await hostLocation(provider);
    const result = inlineResult(location);
    await validateHostActionResult(location, result);

    const runPath = resolve(directory, "run.json");
    const checkpointPath = resolve(directory, "checkpoint.json");
    const resumedPath = resolve(directory, "resumed.json");
    await createRun(runPath, { provider: provider.manifest.id, graph: "main" });
    await updateRunFacts(runPath, {
      host_action_result: JSON.parse(JSON.stringify(result)) as JsonValue,
    });
    await checkpointRun(runPath, checkpointPath);
    await resumeRun(checkpointPath, resumedPath);
    const resumed = await loadRun(resumedPath);
    const recovered = resumed.facts.host_action_result as unknown as HostActionResult;
    await validateHostActionResult(location, recovered);
    expect(recovered).toEqual(result);
  });

  test("invalidates the route, result, and read receipt when the Provider input changes", async () => {
    const { directory, provider } = await copiedProvider();
    const initial = await hostLocation(provider);
    const result = inlineResult(initial.location);
    const receipt = await hostActionResourceReadReceipt(initial.location, result);
    const receiptSet: ResourceReadReceiptSet = {
      schema: "agent-graph.resource-read-receipts.v1",
      provider: provider.manifest.id,
      receipts: [receipt],
    };
    const reused = await resolveRoute(provider, "main", "default", initial.routeId, {
      resourceReceipts: receiptSet,
    });
    expect(reused.resources.required.find((resource) => resource.id === initial.location.id)?.readState)
      .toBe("current");

    const resourcePath = resolve(directory, "resources/resolved-instructions.yaml");
    const original = await readFile(resourcePath, "utf8");
    await writeTextAtomic(resourcePath, original.replace("instructions:current", "instructions:next"));
    const changedProvider = await loadProvider(resolve(directory, "provider.yaml"));
    const changedEvaluation = evaluateGraph(changedProvider, "main").evaluation;
    expect(changedEvaluation.revision).not.toBe(initial.revision);
    await expect(resolveRoute(
      changedProvider,
      "main",
      "default",
      changedEvaluation.primaryRoute!.routeId,
      {},
      initial.revision,
    )).rejects.toMatchObject({ code: "route-revision-stale" });

    const changed = await resolveRoute(
      changedProvider,
      "main",
      "default",
      changedEvaluation.primaryRoute!.routeId,
      { resourceReceipts: receiptSet },
      changedEvaluation.revision,
    );
    const changedLocation = changed.resources.required.find((resource) => resource.id === initial.location.id);
    expect(changedLocation?.readState).toBe("read-required");
    expect(changedLocation?.schema).toBe("agent-graph.resource-location.host-action.v1");
    if (changedLocation?.schema === "agent-graph.resource-location.host-action.v1") {
      expect(hostActionInputDigest(changedLocation)).not.toBe(hostActionInputDigest(initial.location));
      await expect(validateHostActionResult(changedLocation, result))
        .rejects.toMatchObject({ code: "host-action-input-stale" });
    }
  });
});

describe("host-materialized resource authoring validation", () => {
  test("rejects an incomplete Host materializer contract", async () => {
    const { directory } = await copiedProvider();
    const actionPath = resolve(directory, "actions/materialize.yaml");
    const original = await readFile(actionPath, "utf8");
    for (const [field, code] of [
      ["handler: example.materialize-resolved-instructions/v1\n", "schema-invalid"],
      ["inputSchema: schemas/materialize-request.schema.json\n", "host-materializer-contract-missing"],
      ["outputSchema: schemas/materialized-resource.schema.json\n", "host-materializer-contract-missing"],
    ] as const) {
      await writeTextAtomic(actionPath, original.replace(field, ""));
      await expect(loadProvider(resolve(directory, "provider.yaml")))
        .rejects.toMatchObject({ code });
    }
  });

  test("rejects the wrong runner and an invalid input before dispatch", async () => {
    const wrongRunner = await copiedProvider();
    await writeTextAtomic(resolve(wrongRunner.directory, "actions/materialize.yaml"), [
      "schema: agent-graph.action.v1",
      "id: materialize-resolved-instructions",
      "runner: command",
      "effect: read",
      "command: echo invalid",
      "inputSchema: schemas/materialize-request.schema.json",
      "outputSchema: schemas/materialized-resource.schema.json",
      "",
    ].join("\n"));
    await expect(loadProvider(resolve(wrongRunner.directory, "provider.yaml")))
      .rejects.toMatchObject({ code: "host-materializer-runner-invalid" });

    const invalidInput = await copiedProvider();
    const resourcePath = resolve(invalidInput.directory, "resources/resolved-instructions.yaml");
    const original = await readFile(resourcePath, "utf8");
    await writeTextAtomic(resourcePath, original.replace("resource_ref: instructions:current", "resource_ref: \"\""));
    await expect(loadProvider(resolve(invalidInput.directory, "provider.yaml")))
      .rejects.toMatchObject({ code: "schema-invalid" });
  });

  test("requires versioned input and output schema identities", async () => {
    const { directory } = await copiedProvider();
    const schemaPath = resolve(directory, "schemas/materialize-request.schema.json");
    const original = await readFile(schemaPath, "utf8");
    await writeTextAtomic(schemaPath, original.replace("example.materialize-request/v1", "example.materialize-request"));
    await expect(loadProvider(resolve(directory, "provider.yaml")))
      .rejects.toMatchObject({ code: "schema-protocol-id-unversioned" });
  });
});
