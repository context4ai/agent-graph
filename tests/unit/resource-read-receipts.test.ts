import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { evaluateGraph, loadProvider, resolveRoute } from "../../src/index.js";
import type { ResourceLocation, ResourceReadReceiptSet } from "../../src/types.js";

const UNKNOWN_DIGEST = `sha256:${"0".repeat(64)}`;

function receiptSet(provider: string, resources: ResourceLocation[]): ResourceReadReceiptSet {
  return {
    schema: "agent-graph.resource-read-receipts.v1",
    provider,
    receipts: resources.map((resource) => ({
      id: resource.id,
      digest: resource.digest ?? UNKNOWN_DIGEST,
      ...(resource.revision ? { revision: resource.revision } : {}),
    })),
  };
}

describe("resource read receipts", () => {
  test("reuses static resources only when their content digest matches", async () => {
    const provider = await loadProvider(resolve(import.meta.dir, "../../examples/simple-skill/provider.yaml"));
    const evaluation = evaluateGraph(provider, "main").evaluation;
    const first = await resolveRoute(provider, "main", "default", evaluation.primaryRoute!.routeId);
    expect(first.resources.required.every((resource) => resource.readState === "read-required")).toBe(true);

    const current = await resolveRoute(provider, "main", "default", evaluation.primaryRoute!.routeId, {
      resourceReceipts: receiptSet(provider.manifest.id, first.resources.required),
    });
    expect(current.revision).toBe(evaluation.revision);
    expect(current.resources.required.every((resource) => resource.readState === "current")).toBe(true);
    expect(current.action?.skill?.readState).toBe("current");

    const staleResource = first.resources.required[0]!;
    const stale = await resolveRoute(provider, "main", "default", evaluation.primaryRoute!.routeId, {
      resourceReceipts: {
        schema: "agent-graph.resource-read-receipts.v1",
        provider: provider.manifest.id,
        receipts: [{ id: staleResource.id, digest: UNKNOWN_DIGEST }],
      },
    });
    expect(stale.resources.required.find((resource) => resource.id === staleResource.id)?.readState).toBe("read-required");

    await expect(resolveRoute(provider, "main", "default", evaluation.primaryRoute!.routeId, {
      resourceReceipts: { ...receiptSet(provider.manifest.id, first.resources.required), provider: "another.provider" },
    })).rejects.toMatchObject({ code: "resource-receipts-provider-mismatch" });
  });

  test("invalidates dynamic views when the route revision changes", async () => {
    const provider = await loadProvider(resolve(import.meta.dir, "../../examples/dynamic-resource/provider.yaml"));
    const initialEvaluation = evaluateGraph(provider, "diagnose").evaluation;
    const initial = await resolveRoute(provider, "diagnose", "default", initialEvaluation.primaryRoute!.routeId);
    const receipts = receiptSet(provider.manifest.id, initial.resources.required);

    const reused = await resolveRoute(
      provider,
      "diagnose",
      "default",
      initialEvaluation.primaryRoute!.routeId,
      { resourceReceipts: receipts },
    );
    expect(reused.resources.required.every((resource) => resource.readState === "current")).toBe(true);

    const changedInput = { facts: { workspace: { changed: true } }, resourceReceipts: receipts };
    const changedEvaluation = evaluateGraph(provider, "diagnose", "default", changedInput).evaluation;
    const changed = await resolveRoute(
      provider,
      "diagnose",
      "default",
      changedEvaluation.primaryRoute!.routeId,
      changedInput,
    );
    expect(changed.revision).not.toBe(initial.revision);
    expect(changed.resources.required.find((resource) => resource.kind === "context-view")?.readState).toBe("read-required");
    expect(changed.resources.required.find((resource) => resource.id === "diagnosis.procedure")?.readState).toBe("current");
  });
});
