#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };
import {
  AgentGraphError,
  DEFAULT_MATERIALIZER_MAX_ERROR_BYTES,
  DEFAULT_MATERIALIZER_MAX_OUTPUT_BYTES,
  DEFAULT_MATERIALIZER_TIMEOUT_MS,
  OUTCOMES,
  assertRunTargetsProvider,
  buildProviderBundle,
  checkpointRun,
  createRun,
  ensureFile,
  evaluateGraph,
  importScripts,
  importSkill,
  importWorkflow,
  initProvider,
  inspectProvider,
  loadProvider,
  loadRun,
  locateResource,
  materializeResource,
  publicSchemaRoot,
  readProviderRegistry,
  readSkillLocator,
  readStructuredFile,
  recordOutcome,
  resolveRoute,
  resolveSkillManifest,
  resumeRun,
  runEvaluationInput,
  runGraphTests,
  schemaDocument,
  schemaPath,
  schemaTypes,
  updateRunAuthorities,
  updateRunFacts,
  writeJsonAtomic,
} from "./index.js";
import type { EvaluationInput, JsonValue, LoadedProvider, Outcome } from "./types.js";

const VERSION = packageMetadata.version;

interface GlobalOptions {
  manifest: string;
  skill?: string;
  registry?: string;
  format: "human" | "json";
}

function globals(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}

function output(command: Command, value: unknown, lines?: string[]): void {
  if (globals(command).format === "json") process.stdout.write(`${JSON.stringify(value)}\n`);
  else process.stdout.write(`${(lines ?? [JSON.stringify(value, null, 2)]).join("\n")}\n`);
}

async function providerFor(command: Command): Promise<LoadedProvider> {
  const options = globals(command);
  let manifest = resolve(options.manifest);
  const registry = options.registry ? await readProviderRegistry(options.registry) : undefined;
  if (options.skill) manifest = (await resolveSkillManifest(options.skill, { registry })).manifestPath;
  return loadProvider(manifest);
}

async function jsonArgument(value: string): Promise<JsonValue> {
  if (value.startsWith("@")) return readStructuredFile<JsonValue>(resolve(value.slice(1)));
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    throw new AgentGraphError("json-invalid", `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function objectValue(value: JsonValue, label: string): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new AgentGraphError("json-object-required", `${label} must be a JSON object`);
  }
  return value;
}

function outcomeValues(value: JsonValue): Record<string, Outcome> {
  const object = objectValue(value, "outcomes");
  const outcomes: Record<string, Outcome> = {};
  for (const [node, outcome] of Object.entries(object)) {
    if (typeof outcome !== "string" || !OUTCOMES.includes(outcome as Outcome)) {
      throw new AgentGraphError("outcome-invalid", `Outcome for ${node} is invalid: ${JSON.stringify(outcome)}`);
    }
    outcomes[node] = outcome as Outcome;
  }
  return outcomes;
}

function positiveIntegerOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AgentGraphError("option-invalid", `Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

async function evaluationInput(options: { state?: string; facts?: string; outcomes?: string; authority?: string[] }): Promise<EvaluationInput> {
  const directFacts = options.facts ? objectValue(await jsonArgument(options.facts), "facts") : {};
  const directOutcomes = options.outcomes ? outcomeValues(await jsonArgument(options.outcomes)) : {};
  if (options.state) {
    const stored = runEvaluationInput(await loadRun(options.state));
    return {
      ...stored,
      facts: { ...stored.facts, ...directFacts },
      outcomes: { ...stored.outcomes, ...directOutcomes },
      authorities: [...new Set([...(stored.authorities ?? []), ...(options.authority ?? [])])].sort(),
    };
  }
  return { facts: directFacts, outcomes: directOutcomes, authorities: options.authority ?? [] };
}

function addEvaluationOptions(command: Command): Command {
  return command
    .option("--entry <name>", "graph entrypoint", "default")
    .option("--state <path>", "explicit run state file")
    .option("--facts <json>", "facts as JSON or @file")
    .option("--outcomes <json>", "explicit node outcomes as JSON or @file")
    .option("--authority <id...>", "session-scoped delegated authorities");
}

const program = new Command()
  .name("agent-graph")
  .description("Model-free work-contract graphs for Agent Skills")
  .version(VERSION)
  .option("-m, --manifest <path>", "provider or bundle manifest", "provider.yaml")
  .option("--skill <path>", "resolve the provider through metadata.agent-graph in a SKILL.md")
  .option("--registry <path>", "host provider registry for provider: locators")
  .option("--format <format>", "output format: human or json", "human")
  .hook("preAction", (_root, action) => {
    const format = globals(action).format;
    if (format !== "human" && format !== "json") throw new AgentGraphError("format-invalid", `Unsupported format: ${format}`);
  });

program.command("init")
  .description("create a new provider source tree")
  .argument("[directory]", "destination directory", ".")
  .requiredOption("--id <id>", "provider id")
  .action(async (directory: string, options: { id: string }, command: Command) => {
    const manifest = await initProvider(directory, options.id);
    output(command, { state: "created", manifest }, [`Created Agent Graph provider: ${manifest}`, `Next: agent-graph validate --manifest ${manifest}`]);
  });

const importCommand = program.command("import").description("convert an existing Skill, script set, or workflow into provider sources");

importCommand.command("skill")
  .argument("<skill>", "source SKILL.md")
  .requiredOption("--into <directory>", "existing provider root")
  .option("--graph <id>", "generated graph id")
  .action(async (skill: string, options: { into: string; graph?: string }, command: Command) => {
    const graph = await importSkill(skill, options.into, options.graph);
    output(command, { state: "imported", kind: "skill", graph }, [`Imported Skill into ${graph}`, "Review IMPORT_REPORT.md before relying on generated semantics."]);
  });

importCommand.command("scripts")
  .argument("<scripts...>", "source scripts in execution order")
  .requiredOption("--into <directory>", "existing provider root")
  .option("--graph <id>", "generated graph id", "imported-scripts")
  .action(async (scripts: string[], options: { into: string; graph: string }, command: Command) => {
    const graph = await importScripts(scripts, options.into, options.graph);
    output(command, { state: "imported", kind: "scripts", graph }, [`Imported scripts into ${graph}`, "Review IMPORT_REPORT.md before relying on generated semantics."]);
  });

importCommand.command("workflow")
  .argument("<workflow>", "legacy YAML or JSON workflow")
  .requiredOption("--into <directory>", "existing provider root")
  .option("--graph <id>", "generated graph id")
  .action(async (workflow: string, options: { into: string; graph?: string }, command: Command) => {
    const graph = await importWorkflow(workflow, options.into, options.graph);
    output(command, { state: "imported", kind: "workflow", graph }, [`Imported workflow into ${graph}`, "Review IMPORT_REPORT.md before relying on generated semantics."]);
  });

program.command("validate")
  .description("validate schemas, references, graph dependencies, and safety invariants")
  .action(async (_options: object, command: Command) => {
    const provider = await providerFor(command);
    const inspection = inspectProvider(provider);
    output(command, { state: "valid", ...inspection }, [
      `Valid provider ${provider.manifest.id}@${provider.manifest.version}`,
      `${provider.graphs.size} graph(s), ${provider.actions.size} action(s), ${provider.resources.size} resource(s)`,
    ]);
  });

program.command("build")
  .description("build a deterministic, relocatable provider bundle")
  .argument("[output]", "output directory", "dist/provider")
  .action(async (destination: string, _options: object, command: Command) => {
    const manifest = await buildProviderBundle(await providerFor(command), destination);
    output(command, manifest, [
      `Built ${manifest.provider.id}@${manifest.provider.version} at ${resolve(destination)}`,
      `Bundle digest: ${manifest.digest}`,
    ]);
  });

program.command("test")
  .description("evaluate declarative graph test cases")
  .argument("[path]", "test file or directory", "tests")
  .action(async (path: string, _options: object, command: Command) => {
    const results = await runGraphTests(await providerFor(command), path);
    const failed = results.filter((result) => !result.passed);
    output(command, { state: failed.length === 0 ? "passed" : "failed", total: results.length, failed: failed.length, results }, [
      `${results.length - failed.length}/${results.length} graph test(s) passed`,
      ...failed.flatMap((result) => [`FAIL ${result.name}`, ...result.failures.map((failure) => `  ${failure}`)]),
    ]);
    if (failed.length > 0) process.exitCode = 1;
  });

const inspectCommand = program.command("inspect").description("inspect provider and Skill bindings without executing actions");

inspectCommand.command("provider")
  .action(async (_options: object, command: Command) => {
    const inspection = inspectProvider(await providerFor(command));
    output(command, inspection, [
      `${inspection.provider.id}@${inspection.provider.version}`,
      `${inspection.counts.graphs} graph(s), ${inspection.counts.actions} action(s), ${inspection.counts.resources} resource(s)`,
      ...inspection.graphs.map((graph) => `- ${graph.id} [${Object.keys(graph.entrypoints).join(", ")}] ${graph.nodes.length} node(s)`),
    ]);
  });

inspectCommand.command("skill")
  .argument("<skill>", "SKILL.md to inspect")
  .action(async (skill: string, _options: object, command: Command) => {
    const options = globals(command);
    const registry = options.registry ? await readProviderRegistry(options.registry) : undefined;
    const locator = await readSkillLocator(skill);
    const resolution = await resolveSkillManifest(skill, { registry });
    const provider = await loadProvider(resolution.manifestPath);
    output(command, { skill: resolve(skill), locator, provider: inspectProvider(provider) }, [
      `Locator: ${locator}`,
      `Provider: ${provider.manifest.id}@${provider.manifest.version}`,
    ]);
  });

addEvaluationOptions(program.command("evaluate")
  .description("evaluate current facts and outcomes without executing an action")
  .argument("<graph>", "graph id"))
  .action(async (graph: string, options: { entry: string; state?: string; facts?: string; outcomes?: string; authority?: string[] }, command: Command) => {
    const provider = await providerFor(command);
    const input = await evaluationInput(options);
    const result = evaluateGraph(provider, graph, options.entry, input).evaluation;
    output(command, result, [
      `State: ${result.statusCode}`,
      ...(result.primaryRoute ? [`Next: ${result.primaryRoute.node} (${result.primaryRoute.availability})`, `Route: ${result.primaryRoute.routeId}`] : []),
      ...result.diagnostics.map((diagnostic) => `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`),
    ]);
  });

addEvaluationOptions(program.command("route")
  .description("resolve one evaluated route into commands, resources, gates, and the recording contract")
  .argument("<graph>", "graph id")
  .argument("[route-id]", "route id; defaults to the current primary route")
  .option("--revision <digest>", "bind resolution to the revision returned by evaluate"))
  .action(async (
    graph: string,
    routeId: string | undefined,
    options: { entry: string; state?: string; facts?: string; outcomes?: string; authority?: string[]; revision?: string },
    command: Command,
  ) => {
    const provider = await providerFor(command);
    const input = await evaluationInput(options);
    const evaluated = evaluateGraph(provider, graph, options.entry, input).evaluation;
    const selected = routeId ?? evaluated.primaryRoute?.routeId;
    if (!selected) throw new AgentGraphError("route-unavailable", `Graph ${graph} has no available route`);
    const route = await resolveRoute(provider, graph, options.entry, selected, input, options.revision);
    output(command, route, [
      `Next: ${route.node} (${route.availability})`,
      ...route.commandPlan.flatMap((item) => [
        item.command ? `Command: ${item.command}` : `Host handler: ${item.handler}`,
        `Working directory: ${item.workingDirectory}`,
      ]),
      ...route.resources.required.map((resource) => `Required: ${resource.filePath ?? `materialize ${resource.id}`}`),
      ...route.resources.recommended.map((resource) => `Recommended: ${resource.filePath ?? `materialize ${resource.id}`}`),
      ...(route.gate ? [`Gate: ${route.gate.prompt}`] : []),
      `After action: record ${route.afterAction.recordNode ?? route.node}, then evaluate again`,
    ]);
  });

const runCommand = program.command("run").description("manage an explicit, host-owned run state file");

runCommand.command("start")
  .argument("<graph>", "graph id")
  .requiredOption("--state <path>", "run state file")
  .option("--entry <name>", "graph entrypoint", "default")
  .option("--workspace <path>", "workspace used by routed actions", ".")
  .option("--facts <json>", "initial facts as JSON or @file")
  .option("--authority <id...>", "session-scoped delegated authorities")
  .action(async (graph: string, options: { state: string; entry: string; workspace: string; facts?: string; authority?: string[] }, command: Command) => {
    const provider = await providerFor(command);
    const facts = options.facts ? objectValue(await jsonArgument(options.facts), "facts") : {};
    const run = await createRun(options.state, {
      provider: provider.manifest.id,
      graph,
      entry: options.entry,
      workspace: options.workspace,
      facts,
      authorities: options.authority,
    });
    output(command, run, [`Started run ${run.id}`, `State: ${resolve(options.state)}`, `Next: agent-graph run status --state ${resolve(options.state)}`]);
  });

runCommand.command("status")
  .requiredOption("--state <path>", "run state file")
  .action(async (options: { state: string }, command: Command) => {
    const provider = await providerFor(command);
    const run = await loadRun(options.state);
    assertRunTargetsProvider(run, provider.manifest.id);
    const evaluation = evaluateGraph(provider, run.graph, run.entry, runEvaluationInput(run)).evaluation;
    output(command, { run: { id: run.id, state: resolve(options.state), updatedAt: run.updatedAt }, evaluation }, [
      `Run: ${run.id}`,
      `State: ${evaluation.statusCode}`,
      ...(evaluation.primaryRoute ? [`Next: ${evaluation.primaryRoute.node}`, `Route: ${evaluation.primaryRoute.routeId}`] : []),
    ]);
  });

runCommand.command("record")
  .argument("<node>", "state key returned by route.afterAction.recordNode")
  .argument("<outcome>", `one of: ${OUTCOMES.join(", ")}`)
  .requiredOption("--state <path>", "run state file")
  .option("--detail <json>", "optional JSON detail or @file")
  .action(async (node: string, outcomeValue: string, options: { state: string; detail?: string }, command: Command) => {
    if (!OUTCOMES.includes(outcomeValue as Outcome)) throw new AgentGraphError("outcome-invalid", `Unsupported outcome: ${outcomeValue}`);
    const detail = options.detail ? await jsonArgument(options.detail) : undefined;
    const run = await recordOutcome(options.state, node, outcomeValue as Outcome, detail);
    output(command, run, [`Recorded ${node}: ${outcomeValue}`, "Evaluate the run again; recorded outcomes are not assumed to prove facts."]);
  });

runCommand.command("facts")
  .requiredOption("--state <path>", "run state file")
  .requiredOption("--set <json>", "facts object as JSON or @file")
  .option("--replace", "replace all facts instead of merging", false)
  .action(async (options: { state: string; set: string; replace: boolean }, command: Command) => {
    const run = await updateRunFacts(options.state, objectValue(await jsonArgument(options.set), "facts"), options.replace);
    output(command, run, [`Updated facts for run ${run.id}`]);
  });

runCommand.command("authority")
  .requiredOption("--state <path>", "run state file")
  .option("--set <id...>", "replace session-scoped authorities", [])
  .action(async (options: { state: string; set: string[] }, command: Command) => {
    const run = await updateRunAuthorities(options.state, options.set);
    output(command, run, [`Authorities: ${run.authorities.join(", ") || "<none>"}`]);
  });

runCommand.command("checkpoint")
  .requiredOption("--state <path>", "run state file")
  .requiredOption("--to <path>", "checkpoint destination")
  .action(async (options: { state: string; to: string }, command: Command) => {
    const result = await checkpointRun(options.state, options.to);
    output(command, result, [`Checkpoint: ${result.checkpoint}`]);
  });

runCommand.command("resume")
  .argument("<checkpoint>", "checkpoint file")
  .requiredOption("--state <path>", "new run state file")
  .action(async (checkpoint: string, options: { state: string }, command: Command) => {
    const run = await resumeRun(checkpoint, options.state);
    output(command, run, [`Resumed run ${run.id} at ${resolve(options.state)}`]);
  });

runCommand.command("events")
  .requiredOption("--state <path>", "run state file")
  .action(async (options: { state: string }, command: Command) => {
    const run = await loadRun(options.state);
    output(command, { run: run.id, events: run.events }, run.events.map((event) => `${event.sequence} ${event.at} ${event.type}${event.node ? ` ${event.node}` : ""}`));
  });

const resourceCommand = program.command("resource").description("locate or explicitly materialize route resources");

resourceCommand.command("locate")
  .argument("<resource>", "resource id or provider-relative path")
  .action(async (resource: string, _options: object, command: Command) => {
    const location = await locateResource(await providerFor(command), resource);
    output(command, location, [location.filePath ?? `Dynamic resource ${location.id}; run resource materialize explicitly.`]);
  });

resourceCommand.command("materialize")
  .argument("<resource>", "dynamic resource id or provider-relative path")
  .requiredOption("--cache <directory>", "host-selected cache directory")
  .requiredOption("--revision <digest>", "revision from the route that selected this context view")
  .option("--workspace <directory>", "workspace visible to the read-only materializer", ".")
  .option("--input <json>", "materializer input JSON or @file")
  .option("--timeout-ms <milliseconds>", "maximum materializer runtime", positiveIntegerOption, DEFAULT_MATERIALIZER_TIMEOUT_MS)
  .option("--max-output-bytes <bytes>", "maximum captured stdout", positiveIntegerOption, DEFAULT_MATERIALIZER_MAX_OUTPUT_BYTES)
  .option("--max-error-bytes <bytes>", "maximum captured stderr", positiveIntegerOption, DEFAULT_MATERIALIZER_MAX_ERROR_BYTES)
  .action(async (resource: string, options: {
    cache: string;
    workspace: string;
    revision: string;
    input?: string;
    timeoutMs: number;
    maxOutputBytes: number;
    maxErrorBytes: number;
  }, command: Command) => {
    const input = options.input ? await jsonArgument(options.input) : undefined;
    const location = await materializeResource(await providerFor(command), resource, {
      cache: options.cache,
      workspace: options.workspace,
      revision: options.revision,
      input,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      maxErrorBytes: options.maxErrorBytes,
    });
    output(command, location, [`Materialized ${location.id}: ${location.filePath}`, `Digest: ${location.digest}`]);
  });

const schemaCommand = program.command("schema").description("discover bundled public JSON schemas");
schemaCommand.command("list").action((_options: object, command: Command) => {
  const names = schemaTypes();
  output(command, { root: publicSchemaRoot(), schemas: names }, names);
});
schemaCommand.command("path")
  .argument("<name>", "schema name")
  .action(async (name: string, _options: object, command: Command) => {
    const path = schemaPath(name);
    await ensureFile(path, "packaged schema (use `schema extract` with the standalone CLI)");
    output(command, { name, path }, [path]);
  });
schemaCommand.command("extract")
  .description("write one embedded schema to a host-selected file")
  .argument("<name>", "schema name")
  .requiredOption("--output <path>", "destination JSON file")
  .action(async (name: string, options: { output: string }, command: Command) => {
    const destination = resolve(options.output);
    await writeJsonAtomic(destination, schemaDocument(name));
    output(command, { name, path: destination }, [destination]);
  });

export async function runCli(argv = process.argv): Promise<void> {
  try {
    await program.parseAsync(argv);
  } catch (error: unknown) {
    const options = program.opts() as GlobalOptions;
    const known = error instanceof AgentGraphError
      ? error
      : new AgentGraphError("unexpected-error", error instanceof Error ? error.message : String(error));
    if (options.format === "json") {
      process.stderr.write(`${JSON.stringify({ state: "error", error: { code: known.code, message: known.message, diagnostics: known.diagnostics } })}\n`);
    } else {
      process.stderr.write(`ERROR ${known.code}: ${known.message}\n`);
      for (const diagnostic of known.diagnostics) process.stderr.write(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}\n`);
    }
    process.exitCode = 1;
  }
}
