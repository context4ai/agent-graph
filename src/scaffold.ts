import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import YAML from "yaml";
import { AgentGraphError } from "./errors.js";
import { listFilesRecursive, parseFrontmatter, readStructuredFile, readText, relativePortable, resolveContainedPath, writeTextAtomic } from "./io.js";
import type { ActionDefinition, CodeCatalogDefinition, GraphDefinition, ProviderManifest } from "./types.js";

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/\.{2,}/g, "-")
    .replaceAll(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!normalized) throw new AgentGraphError("id-invalid", `Cannot derive an id from ${value}`);
  return normalized;
}

async function writeYaml(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, YAML.stringify(value, { lineWidth: 0 }));
}

async function ensureTargetsAbsent(paths: string[]): Promise<void> {
  for (const path of paths) {
    if (await stat(path).catch(() => null)) {
      throw new AgentGraphError("import-target-exists", `Import refuses to replace existing content: ${path}`);
    }
  }
}

async function appendImportReport(root: string, heading: string, body: string): Promise<void> {
  const path = resolve(root, "IMPORT_REPORT.md");
  const previous = await stat(path).catch(() => null) ? await readText(path) : "# Import report\n";
  await writeTextAtomic(path, `${previous.trimEnd()}\n\n## ${heading}\n\n${body.trim()}\n`);
}

function starterGraph(): GraphDefinition {
  return {
    schema: "agent-graph.graph.v1",
    id: "main",
    description: "Starter graph that delegates one action to an Agent Skill.",
    entrypoints: { default: "work" },
    nodes: [
      {
        id: "work",
        kind: "action",
        action: "actions/work.yaml",
        description: "Perform the work",
        reasonCode: "route.main.work",
        resources: { required: ["resources/procedure.md"] },
      },
      { id: "done", kind: "terminal", terminalOutcome: "completed" },
    ],
    edges: [{ from: "work", to: "done", outcomes: ["completed"] }],
  };
}

export async function initProvider(directory: string, id: string): Promise<string> {
  const root = resolve(directory);
  const targets = [
    resolve(root, "provider.yaml"),
    resolve(root, "graphs/main.yaml"),
    resolve(root, "actions/work.yaml"),
    resolve(root, "skills/getting-started/SKILL.md"),
    resolve(root, "resources/procedure.md"),
    resolve(root, "tests/main.yaml"),
    resolve(root, "codes.yaml"),
  ];
  for (const target of targets) {
    if (await stat(target).catch(() => null)) {
      throw new AgentGraphError("provider-target-exists", `Provider initialization refuses to replace existing content: ${target}`);
    }
  }
  const provider: ProviderManifest = {
    schema: "agent-graph.provider.v1",
    id: slug(id),
    version: "0.1.0",
    name: id,
    graphs: ["graphs/main.yaml"],
    catalogs: { codes: "codes.yaml" },
    compatibility: { agentGraph: "^0.2.0", node: ">=20" },
  };
  const action: ActionDefinition = {
    schema: "agent-graph.action.v1",
    id: "work",
    runner: "agent",
    effect: "write",
    skill: "skills/getting-started/SKILL.md",
  };
  await writeYaml(targets[0]!, provider);
  await writeYaml(targets[1]!, starterGraph());
  await writeYaml(targets[2]!, action);
  await writeTextAtomic(targets[3]!, `---
name: getting-started
description: Complete the current task using the route and resources supplied by Agent Graph.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: main
  agent-graph.entry: default
---

# Getting started

Follow the resolved route. Read every required resource marked \`read-required\` before acting, then record an explicit outcome.
`);
  await writeTextAtomic(targets[4]!, `---
id: procedure.start
kind: procedure
media-type: text/markdown
---

# Procedure

Replace this resource with the context needed by an Agent only when a route selects it.
`);
  await writeYaml(targets[5]!, {
    schema: "agent-graph.test.v1",
    name: "starter route is actionable",
    graph: "main",
    entry: "default",
    expect: { statusCode: "actionable", primaryNode: "work", primaryReasonCode: "route.main.work" },
  });
  await writeYaml(targets[6]!, {
    schema: "agent-graph.code-catalog.v1",
    codes: [{
      code: "route.main.work",
      kind: "route-reason",
      summary: "The requested work is ready to perform.",
      document: "resources/procedure.md",
    }],
  });
  return resolve(root, "provider.yaml");
}

async function readProvider(root: string): Promise<{ path: string; manifest: ProviderManifest }> {
  const path = resolve(root, "provider.yaml");
  return { path, manifest: await readStructuredFile<ProviderManifest>(path) };
}

async function appendGraph(root: string, graphPath: string): Promise<void> {
  const provider = await readProvider(root);
  const relative = relativePortable(root, graphPath);
  if (!provider.manifest.graphs.includes(relative)) provider.manifest.graphs.push(relative);
  provider.manifest.graphs.sort();
  await writeYaml(provider.path, provider.manifest);
}

async function appendRouteReasons(
  root: string,
  reasons: Array<{ code: string; summary: string }>,
): Promise<void> {
  const provider = await readProvider(root);
  const reference = provider.manifest.catalogs?.codes;
  if (!reference) return;
  const path = resolveContainedPath(root, reference, "code catalog reference");
  const catalog = await readStructuredFile<CodeCatalogDefinition>(path);
  const existing = new Map(catalog.codes.map((entry) => [entry.code, entry]));
  for (const reason of reasons) {
    const entry = existing.get(reason.code);
    if (entry && entry.kind !== "route-reason") {
      throw new AgentGraphError("route-reason-code-kind-invalid", `Code ${reason.code} is not a route-reason`);
    }
    if (entry) continue;
    catalog.codes.push({ code: reason.code, kind: "route-reason", summary: reason.summary });
  }
  catalog.codes.sort((left, right) => left.code.localeCompare(right.code));
  await writeYaml(path, catalog);
}

async function copyTree(source: string, destination: string): Promise<void> {
  for (const file of await listFilesRecursive(source)) {
    const target = resolve(destination, relativePortable(source, file));
    await mkdir(resolve(target, ".."), { recursive: true });
    await copyFile(file, target);
  }
}

async function bindImportedSkill(skillPath: string, locator: string, graph: string, entry: string): Promise<string> {
  const content = await readText(skillPath);
  const parsed = parseFrontmatter(content, skillPath);
  const name = typeof parsed.metadata.name === "string" ? parsed.metadata.name : basename(resolve(skillPath, ".."));
  const metadata = parsed.metadata.metadata;
  const extension = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
  extension["agent-graph"] = locator;
  extension["agent-graph.graph"] = graph;
  extension["agent-graph.entry"] = entry;
  const next = { ...parsed.metadata, name, metadata: extension };
  await writeTextAtomic(skillPath, `---\n${YAML.stringify(next, { lineWidth: 0 }).trimEnd()}\n---\n${parsed.body}`);
  return name;
}

export async function importSkill(sourceSkill: string, providerRoot: string, graphId?: string): Promise<string> {
  const source = resolve(sourceSkill);
  const sourceRoot = resolve(source, "..");
  const id = slug(graphId ?? basename(sourceRoot));
  const root = resolve(providerRoot);
  await readProvider(root);
  const skillDirectory = resolve(root, "skills", id);
  const actionPath = resolve(root, "actions", `${id}.yaml`);
  const graphPath = resolve(root, "graphs", `${id}.yaml`);
  await ensureTargetsAbsent([skillDirectory, actionPath, graphPath]);
  await copyTree(sourceRoot, skillDirectory);
  const copiedSkill = resolve(skillDirectory, "SKILL.md");
  const skillName = await bindImportedSkill(copiedSkill, "path:../../provider.yaml", id, "default");
  await writeYaml(actionPath, {
    schema: "agent-graph.action.v1",
    id: `skill.${id}`,
    runner: "agent",
    effect: "write",
    skill: relativePortable(root, copiedSkill),
  } satisfies ActionDefinition);
  await writeYaml(graphPath, {
    schema: "agent-graph.graph.v1",
    id,
    entrypoints: { default: "use-skill" },
    nodes: [
      {
        id: "use-skill",
        kind: "action",
        action: relativePortable(root, actionPath),
        description: `Use ${skillName}`,
        reasonCode: `route.${id}.use-skill`,
      },
      { id: "done", kind: "terminal", terminalOutcome: "completed" },
    ],
    edges: [{ from: "use-skill", to: "done", outcomes: ["completed"] }],
  } satisfies GraphDefinition);
  await appendRouteReasons(root, [{
    code: `route.${id}.use-skill`,
    summary: "The imported Skill route is ready to use.",
  }]);
  await appendGraph(root, graphPath);
  await appendImportReport(root, `Skill ${id}`, `
- Imported Skill: \`${source}\`
- Generated graph: \`${relativePortable(root, graphPath)}\`
- Generated action: \`${relativePortable(root, actionPath)}\`
- Added Skill binding: Provider \`path:../../provider.yaml\`, Graph \`${id}\`, Entry \`default\`

Review action effects, graph outcomes, recovery paths, gates, and fact-backed completion before production use.
`);
  return graphPath;
}

function runtimeFor(path: string): NonNullable<ActionDefinition["runtime"]> {
  const extension = extname(path).toLowerCase();
  if ([".js", ".mjs", ".cjs"].includes(extension)) return "node";
  if ([".ts", ".mts", ".cts"].includes(extension)) return "bun";
  if (extension === ".py") return "python";
  return "shell";
}

export async function importScripts(scripts: string[], providerRoot: string, requestedId = "imported-scripts"): Promise<string> {
  if (scripts.length === 0) throw new AgentGraphError("import-empty", "At least one script is required");
  const root = resolve(providerRoot);
  await readProvider(root);
  const id = slug(requestedId);
  const graphPath = resolve(root, "graphs", `${id}.yaml`);
  const targets = scripts.flatMap((sourceValue, index) => [
    resolve(root, "scripts", id, `${String(index + 1).padStart(2, "0")}-${basename(resolve(sourceValue))}`),
    resolve(root, "actions", `${id}-${index + 1}.yaml`),
  ]);
  await ensureTargetsAbsent([graphPath, ...targets]);
  const nodes: GraphDefinition["nodes"] = [];
  const edges: GraphDefinition["edges"] = [];
  const reasons: Array<{ code: string; summary: string }> = [];
  for (const [index, sourceValue] of scripts.entries()) {
    const source = resolve(sourceValue);
    const fileName = `${String(index + 1).padStart(2, "0")}-${basename(source)}`;
    const target = resolve(root, "scripts", id, fileName);
    await mkdir(resolve(target, ".."), { recursive: true });
    await copyFile(source, target);
    const nodeId = `step-${index + 1}`;
    const actionPath = resolve(root, "actions", `${id}-${index + 1}.yaml`);
    await writeYaml(actionPath, {
      schema: "agent-graph.action.v1",
      id: `${id}.${nodeId}`,
      runner: "script",
      effect: "write",
      entry: relativePortable(root, target),
      runtime: runtimeFor(target),
    } satisfies ActionDefinition);
    nodes.push({
      id: nodeId,
      kind: "action",
      action: relativePortable(root, actionPath),
      description: basename(source),
      reasonCode: `route.${id}.${nodeId}`,
    });
    reasons.push({
      code: `route.${id}.${nodeId}`,
      summary: `Imported script step ${index + 1} is ready to run.`,
    });
    if (index > 0) edges.push({ from: `step-${index}`, to: nodeId, outcomes: ["completed"] });
  }
  nodes.push({ id: "done", kind: "terminal", terminalOutcome: "completed" });
  edges.push({ from: `step-${scripts.length}`, to: "done", outcomes: ["completed"] });
  await writeYaml(graphPath, {
    schema: "agent-graph.graph.v1",
    id,
    entrypoints: { default: "step-1" },
    nodes,
    edges,
  } satisfies GraphDefinition);
  await appendRouteReasons(root, reasons);
  await appendGraph(root, graphPath);
  await appendImportReport(root, `Scripts ${id}`, `
Imported ${scripts.length} scripts as a sequential graph \`${id}\`.

Review effects, arguments, working directories, branching, recovery, and completion facts before production use.
`);
  return graphPath;
}

interface LegacyWorkflow {
  id?: string;
  steps: Array<{ id: string; command: string; description?: string; dependsOn?: string[]; effect?: ActionDefinition["effect"] }>;
}

export async function importWorkflow(workflowPath: string, providerRoot: string, requestedId?: string): Promise<string> {
  const source = await readStructuredFile<LegacyWorkflow>(resolve(workflowPath));
  if (!Array.isArray(source.steps) || source.steps.length === 0) {
    throw new AgentGraphError("workflow-invalid", "Workflow must contain a non-empty steps array");
  }
  if (source.id !== undefined && (typeof source.id !== "string" || source.id.length === 0)) {
    throw new AgentGraphError("workflow-invalid", "Workflow id must be a non-empty string when present");
  }
  for (const [index, step] of source.steps.entries()) {
    if (step === null || typeof step !== "object" || typeof step.id !== "string" || step.id.length === 0
      || typeof step.command !== "string" || step.command.length === 0) {
      throw new AgentGraphError("workflow-invalid", `Workflow step ${index + 1} must declare non-empty id and command strings`);
    }
    if (step.description !== undefined && typeof step.description !== "string") {
      throw new AgentGraphError("workflow-invalid", `Workflow step ${step.id} description must be a string`);
    }
    if (step.dependsOn !== undefined && (!Array.isArray(step.dependsOn) || step.dependsOn.some((id) => typeof id !== "string"))) {
      throw new AgentGraphError("workflow-invalid", `Workflow step ${step.id} dependsOn must be a string array`);
    }
    if (step.effect !== undefined && !["read", "write", "external"].includes(step.effect)) {
      throw new AgentGraphError("workflow-invalid", `Workflow step ${step.id} has an invalid effect`);
    }
  }
  const root = resolve(providerRoot);
  await readProvider(root);
  const id = slug(requestedId ?? source.id ?? basename(workflowPath, extname(workflowPath)));
  const ids = new Set(source.steps.map((step) => step.id));
  if (ids.size !== source.steps.length) throw new AgentGraphError("workflow-step-duplicate", "Workflow step ids must be unique");
  const normalizedIds = new Map(source.steps.map((step) => [step.id, slug(step.id)]));
  if (new Set(normalizedIds.values()).size !== source.steps.length) {
    throw new AgentGraphError("workflow-step-id-collision", "Workflow step ids must remain unique after normalization");
  }
  if ([...normalizedIds.values()].some((stepId) => stepId === "start" || stepId === "done")) {
    throw new AgentGraphError("workflow-step-id-reserved", "Workflow step ids may not normalize to start or done");
  }
  const stepById = new Map(source.steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string, trail: string[]): void => {
    if (visiting.has(stepId)) {
      const start = trail.indexOf(stepId);
      throw new AgentGraphError("workflow-cycle", `Workflow dependencies contain a cycle: ${[...trail.slice(Math.max(0, start)), stepId].join(" -> ")}`);
    }
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const dependency of stepById.get(stepId)?.dependsOn ?? []) {
      if (!stepById.has(dependency)) {
        throw new AgentGraphError("workflow-dependency-missing", `Step ${stepId} depends on missing step ${dependency}`);
      }
      visit(dependency, [...trail, stepId]);
    }
    visiting.delete(stepId);
    visited.add(stepId);
  };
  for (const step of source.steps) visit(step.id, []);
  const nodes: GraphDefinition["nodes"] = [];
  const edges: GraphDefinition["edges"] = [];
  const reasons: Array<{ code: string; summary: string }> = [{
    code: `route.${id}.start`,
    summary: "The imported workflow is ready to start.",
  }];
  const roots = source.steps.filter((step) => (step.dependsOn ?? []).length === 0);
  const startAction = resolve(root, "actions", `${id}-start.yaml`);
  const graphPath = resolve(root, "graphs", `${id}.yaml`);
  await ensureTargetsAbsent([
    graphPath,
    startAction,
    ...[...normalizedIds.values()].map((nodeId) => resolve(root, "actions", `${id}-${nodeId}.yaml`)),
  ]);
  await writeYaml(startAction, {
    schema: "agent-graph.action.v1", id: `${id}.start`, runner: "command", effect: "read", command: "true",
  } satisfies ActionDefinition);
  nodes.push({
    id: "start",
    kind: "action",
    action: relativePortable(root, startAction),
    description: "Start imported workflow",
    reasonCode: `route.${id}.start`,
  });
  for (const step of source.steps) {
    const nodeId = normalizedIds.get(step.id)!;
    const actionPath = resolve(root, "actions", `${id}-${nodeId}.yaml`);
    await writeYaml(actionPath, {
      schema: "agent-graph.action.v1",
      id: `${id}.${nodeId}`,
      runner: "command",
      effect: step.effect ?? "write",
      command: step.command,
    } satisfies ActionDefinition);
    nodes.push({
      id: nodeId,
      kind: "action",
      action: relativePortable(root, actionPath),
      description: step.description,
      reasonCode: `route.${id}.${nodeId}`,
    });
    reasons.push({
      code: `route.${id}.${nodeId}`,
      summary: "The imported workflow step is ready to run.",
    });
    const dependencies = step.dependsOn ?? [];
    for (const dependency of dependencies) {
      edges.push({ from: normalizedIds.get(dependency)!, to: nodeId, outcomes: ["completed"] });
    }
  }
  for (const step of roots) edges.push({ from: "start", to: normalizedIds.get(step.id)!, outcomes: ["completed"] });
  const dependedOn = new Set(source.steps.flatMap((step) => step.dependsOn ?? []));
  const leaves = source.steps.filter((step) => !dependedOn.has(step.id));
  nodes.push({ id: "done", kind: "terminal", terminalOutcome: "completed", join: "all" });
  for (const leaf of leaves) edges.push({ from: normalizedIds.get(leaf.id)!, to: "done", outcomes: ["completed"] });
  await writeYaml(graphPath, { schema: "agent-graph.graph.v1", id, entrypoints: { default: "start" }, nodes, edges } satisfies GraphDefinition);
  await appendRouteReasons(root, reasons);
  await appendGraph(root, graphPath);
  await appendImportReport(root, `Workflow ${id}`, `
Imported workflow \`${resolve(workflowPath)}\` as graph \`${id}\`.

The importer preserved declared commands and dependencies. Review effects, outcomes, gates, recovery routes, resources, and fact-backed completion before production use.
`);
  return graphPath;
}
