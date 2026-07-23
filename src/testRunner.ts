import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentGraphError } from "./errors.js";
import { evaluateGraph } from "./evaluator.js";
import { listFilesRecursive, readStructuredFile } from "./io.js";
import { resolveRoute } from "./router.js";
import { validateSchema } from "./schema.js";
import type { AgentGraphTestCase, LoadedProvider, TestCaseResult } from "./types.js";

async function discover(path: string): Promise<string[]> {
  const absolute = resolve(path);
  const info = await stat(absolute).catch(() => null);
  if (!info) throw new AgentGraphError("test-path-missing", `Graph test path does not exist: ${absolute}`);
  if (info.isFile()) return [absolute];
  return (await listFilesRecursive(absolute)).filter((file) => /\.(?:ya?ml|json)$/i.test(file));
}

export async function runGraphTests(provider: LoadedProvider, path: string): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const testPaths = await discover(path);
  if (testPaths.length === 0) throw new AgentGraphError("test-cases-empty", `No YAML or JSON graph test cases found: ${resolve(path)}`);
  for (const testPath of testPaths) {
    const test = await readStructuredFile<AgentGraphTestCase>(testPath);
    await validateSchema("test-case", test, testPath);
    const evaluation = evaluateGraph(provider, test.graph, test.entry, test.state).evaluation;
    const failures: string[] = [];
    if (evaluation.statusCode !== test.expect.statusCode) {
      failures.push(`statusCode: expected ${test.expect.statusCode}, received ${evaluation.statusCode}`);
    }
    if (test.expect.primaryNode !== undefined && evaluation.primaryRoute?.node !== test.expect.primaryNode) {
      failures.push(`primaryNode: expected ${test.expect.primaryNode}, received ${evaluation.primaryRoute?.node ?? "<none>"}`);
    }
    if (test.expect.primaryReasonCode !== undefined && evaluation.primaryRoute?.reasonCode !== test.expect.primaryReasonCode) {
      failures.push(`primaryReasonCode: expected ${test.expect.primaryReasonCode}, received ${evaluation.primaryRoute?.reasonCode ?? "<none>"}`);
    }
    if (test.expect.alternativeNodes !== undefined) {
      const actual = evaluation.alternativeRoutes.map((route) => route.node);
      if (JSON.stringify(actual) !== JSON.stringify(test.expect.alternativeNodes)) {
        failures.push(`alternativeNodes: expected ${JSON.stringify(test.expect.alternativeNodes)}, received ${JSON.stringify(actual)}`);
      }
    }
    if (test.expect.availability !== undefined && evaluation.primaryRoute?.availability !== test.expect.availability) {
      failures.push(`availability: expected ${test.expect.availability}, received ${evaluation.primaryRoute?.availability ?? "<none>"}`);
    }
    if (test.expect.outcome !== undefined && evaluation.outcome !== test.expect.outcome) {
      failures.push(`outcome: expected ${test.expect.outcome}, received ${evaluation.outcome ?? "<none>"}`);
    }
    for (const code of test.expect.diagnosticsInclude ?? []) {
      if (!evaluation.diagnostics.some((diagnostic) => diagnostic.code === code)) failures.push(`diagnostic missing: ${code}`);
    }
    const routeExpectations = [
      test.expect.command,
      test.expect.handler,
      test.expect.requiredResources,
      test.expect.recommendedResources,
      test.expect.gateResolution,
      test.expect.recordNode,
    ].some((value) => value !== undefined);
    if (routeExpectations) {
      if (!evaluation.primaryRoute) {
        failures.push("route assertions require a primary route");
      } else {
        const route = await resolveRoute(
          provider,
          test.graph,
          test.entry,
          evaluation.primaryRoute.routeId,
          test.state,
          evaluation.revision,
        );
        if (test.expect.command !== undefined && route.commandPlan[0]?.command !== test.expect.command) {
          failures.push(`command: expected ${test.expect.command}, received ${route.commandPlan[0]?.command ?? "<none>"}`);
        }
        if (test.expect.handler !== undefined && route.commandPlan[0]?.handler !== test.expect.handler) {
          failures.push(`handler: expected ${test.expect.handler}, received ${route.commandPlan[0]?.handler ?? "<none>"}`);
        }
        for (const [label, expected, actual] of [
          ["requiredResources", test.expect.requiredResources, route.resources.required.map((resource) => resource.id)],
          ["recommendedResources", test.expect.recommendedResources, route.resources.recommended.map((resource) => resource.id)],
        ] as const) {
          if (expected !== undefined && JSON.stringify(actual) !== JSON.stringify(expected)) {
            failures.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
          }
        }
        if (test.expect.gateResolution !== undefined && route.gate?.resolution !== test.expect.gateResolution) {
          failures.push(`gateResolution: expected ${test.expect.gateResolution}, received ${route.gate?.resolution ?? "<none>"}`);
        }
        if (test.expect.recordNode !== undefined && route.afterAction.recordNode !== test.expect.recordNode) {
          failures.push(`recordNode: expected ${test.expect.recordNode}, received ${route.afterAction.recordNode ?? "<none>"}`);
        }
      }
    }
    results.push({ name: test.name, path: testPath, passed: failures.length === 0, failures });
  }
  return results;
}
