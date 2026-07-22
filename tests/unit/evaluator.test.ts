import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { evaluateGraph, loadProvider, resolveRoute, validateSchema } from "../../src/index.js";

const example = (name: string) => resolve(import.meta.dir, "../../examples", name, "provider.yaml");

describe("graph evaluation", () => {
  test("chooses a fact-backed recovery route when completion is unverified", async () => {
    const provider = await loadProvider(example("facts-recovery"));
    const result = evaluateGraph(provider, "build", "default", { outcomes: { "build/package": "completed" } }).evaluation;
    expect(result.statusCode).toBe("actionable");
    expect(result.primaryRoute?.node).toBe("verify-artifact");
  });

  test("observed facts can satisfy a node without replaying an action", async () => {
    const provider = await loadProvider(example("facts-recovery"));
    const result = evaluateGraph(provider, "build", "default", { facts: { artifact: { digest: "sha256:test" } } }).evaluation;
    expect(result.statusCode).toBe("complete");
    expect(result.outcome).toBe("completed");
  });

  test("session authority is explicit and scoped to an evaluation", async () => {
    const provider = await loadProvider(example("shared-provider"));
    const outcomes = { "release/inspect": "completed" as const };
    const waiting = evaluateGraph(provider, "release", "default", { outcomes }).evaluation;
    const delegated = evaluateGraph(provider, "release", "default", { outcomes, authorities: ["release.approve"] }).evaluation;
    expect(waiting.statusCode).toBe("waiting-user");
    expect(delegated.statusCode).toBe("actionable");
  });

  test("resolves only the resources selected by the current route", async () => {
    const provider = await loadProvider(example("simple-skill"));
    const evaluation = evaluateGraph(provider, "main").evaluation;
    const route = await resolveRoute(provider, "main", "default", evaluation.primaryRoute!.routeId);
    await validateSchema("evaluation", evaluation, "evaluation");
    await validateSchema("route", route, "route");
    await Promise.all([...route.resources.required, ...route.resources.recommended]
      .map((resource) => validateSchema("resource-location", resource, resource.id)));
    expect(route.resources.required.map((resource) => resource.id)).toEqual([
      "skill.draft-artifact",
      "procedure.drafting",
      "schema.draft-output",
    ]);
    expect(route.resources.required[1]?.filePath).toEndWith("resources/drafting.md");
    expect(route.resources.required[2]?.filePath).toEndWith("schemas/draft-output.schema.json");
    expect(route.action?.runner).toBe("agent");
  });

  test("exposes a child graph action through a parent route", async () => {
    const provider = await loadProvider(example("subgraphs"));
    const result = evaluateGraph(provider, "main").evaluation;
    expect(result.primaryRoute?.node).toBe("prepare");
    const child = evaluateGraph(provider, "main", "default", { outcomes: { "main/prepare": "completed" } }).evaluation;
    const childRoute = await resolveRoute(provider, "main", "default", child.primaryRoute!.routeId, {
      outcomes: { "main/prepare": "completed" },
    });
    expect(childRoute.afterAction.recordNode).toBe("main/quality>quality/check");
    const completed = evaluateGraph(provider, "main", "default", {
      outcomes: {
        "main/prepare": "completed",
        "main/quality>quality/check": "completed",
      },
    }).evaluation;
    expect(completed.statusCode).toBe("complete");
  });

  test("keeps an explicit repeat edge actionable until the action completes", async () => {
    const provider = await loadProvider(example("monitoring-loop"));
    const repeated = evaluateGraph(provider, "monitor", "default", {
      outcomes: { "monitor/poll": "partial" },
    }).evaluation;
    const completed = evaluateGraph(provider, "monitor", "default", {
      outcomes: { "monitor/poll": "completed" },
    }).evaluation;
    expect(repeated.statusCode).toBe("actionable");
    expect(repeated.primaryRoute?.node).toBe("poll");
    expect(completed.statusCode).toBe("complete");
  });

  test("ranks choices deterministically and keeps the evaluation compact", async () => {
    const provider = await loadProvider(example("choice-routing"));
    const input = { outcomes: { "choice/discover": "completed" as const } };
    const evaluation = evaluateGraph(provider, "choice", "default", input).evaluation;
    expect(evaluation.primaryRoute?.node).toBe("option-a");
    expect(evaluation.alternativeRoutes.map((route) => route.node)).toEqual(["option-b", "option-c", "option-d"]);
    expect(evaluation.diagnostics.map((diagnostic) => diagnostic.code)).toContain("route-alternatives-truncated");
    const completed = evaluateGraph(provider, "choice", "default", {
      outcomes: { ...input.outcomes, "choice/option-a": "completed" },
    }).evaluation;
    expect(completed.statusCode).toBe("complete");
  });

  test("rejects a route id after the evaluation revision changes", async () => {
    const provider = await loadProvider(example("simple-skill"));
    const first = evaluateGraph(provider, "main").evaluation;
    await expect(resolveRoute(provider, "main", "default", first.primaryRoute!.routeId, {
      facts: { observation: "new" },
    })).rejects.toMatchObject({ code: "route-stale" });
  });

  test("rejects route resolution when the caller binds a stale revision", async () => {
    const provider = await loadProvider(example("simple-skill"));
    const evaluation = evaluateGraph(provider, "main").evaluation;
    await expect(resolveRoute(
      provider,
      "main",
      "default",
      evaluation.primaryRoute!.routeId,
      {},
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    )).rejects.toMatchObject({ code: "route-revision-stale" });
  });
});
