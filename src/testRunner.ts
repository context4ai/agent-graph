import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentGraphError } from "./errors.js";
import { evaluateGraph } from "./evaluator.js";
import { listFilesRecursive, readStructuredFile } from "./io.js";
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
    if (test.expect.outcome !== undefined && evaluation.outcome !== test.expect.outcome) {
      failures.push(`outcome: expected ${test.expect.outcome}, received ${evaluation.outcome ?? "<none>"}`);
    }
    for (const code of test.expect.diagnosticsInclude ?? []) {
      if (!evaluation.diagnostics.some((diagnostic) => diagnostic.code === code)) failures.push(`diagnostic missing: ${code}`);
    }
    results.push({ name: test.name, path: testPath, passed: failures.length === 0, failures });
  }
  return results;
}
