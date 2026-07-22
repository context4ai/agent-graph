import { resolve } from "node:path";

import { AgentGraphError } from "./errors.js";
import { evaluateGraph, type RouteCandidate } from "./evaluator.js";
import { digestFile, parseFrontmatter, readText, resolveContainedPath } from "./io.js";
import type {
  ActionDefinition,
  DynamicResourceDefinition,
  EvaluationInput,
  LoadedProvider,
  LoadedResource,
  ResourceLocation,
  Route,
  StaticResourceMetadata,
} from "./types.js";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function runtimeCommand(runtime: NonNullable<ActionDefinition["runtime"]>): string {
  switch (runtime) {
    case "node": return "node";
    case "bun": return "bun";
    case "python": return "python3";
    case "shell": return "sh";
  }
}

async function staticLocation(path: string, metadata: StaticResourceMetadata): Promise<ResourceLocation> {
  return {
    schema: "agent-graph.resource-location.v1",
    id: metadata.id,
    kind: metadata.kind,
    mediaType: metadata.mediaType,
    digest: await digestFile(path),
    filePath: path,
  };
}

function dynamicLocation(path: string, metadata: DynamicResourceDefinition, revision?: string): ResourceLocation {
  return {
    schema: "agent-graph.resource-location.v1",
    id: metadata.id,
    kind: metadata.kind,
    mediaType: metadata.mediaType,
    ...(revision ? { revision } : {}),
    materialize: { resourcePath: path },
  };
}

async function locateLoadedResource(resource: LoadedResource, revision?: string): Promise<ResourceLocation> {
  return resource.dynamic
    ? dynamicLocation(resource.path, resource.metadata as DynamicResourceDefinition, revision)
    : staticLocation(resource.contentPath, resource.metadata as StaticResourceMetadata);
}

async function locateSkill(provider: LoadedProvider, reference: string): Promise<ResourceLocation> {
  const path = resolveContainedPath(provider.root, reference, "agent skill reference");
  const content = await readText(path);
  const { metadata } = parseFrontmatter(content, path);
  const name = typeof metadata.name === "string" ? metadata.name : "agent-skill";
  return {
    schema: "agent-graph.resource-location.v1",
    id: `skill.${name}`,
    kind: "skill",
    mediaType: "text/markdown",
    digest: await digestFile(path),
    filePath: path,
  };
}

export async function locateResource(provider: LoadedProvider, referenceOrId: string, revision?: string): Promise<ResourceLocation> {
  const byId = [...provider.resources.values()].find((resource) => resource.metadata.id === referenceOrId);
  if (byId) return locateLoadedResource(byId, revision);
  const directPath = resolveContainedPath(provider.root, referenceOrId, "resource reference");
  const byPath = provider.resources.get(directPath);
  if (byPath) return locateLoadedResource(byPath, revision);
  throw new AgentGraphError("resource-missing", `Provider ${provider.manifest.id} has no resource ${referenceOrId}`);
}

async function resourcesForCandidate(provider: LoadedProvider, candidate: RouteCandidate, revision: string) {
  const requiredReferences = [...(candidate.node.resources?.required ?? [])];
  const recommendedReferences = [...(candidate.node.resources?.recommended ?? [])];
  const action = candidate.node.action
    ? provider.actions.get(resolveContainedPath(provider.root, candidate.node.action, "action reference"))
    : undefined;
  const required = await Promise.all(requiredReferences.map((reference) => locateResource(provider, reference, revision)));
  const recommended = await Promise.all(recommendedReferences.map((reference) => locateResource(provider, reference, revision)));
  if (action?.definition.runner === "agent" && action.definition.skill) {
    required.unshift(await locateSkill(provider, action.definition.skill));
  }
  return { required, recommended };
}

function planForAction(provider: LoadedProvider, action: ActionDefinition, workspace: string): Route["commandPlan"] {
  const cwd = action.cwd ?? "workspace";
  const workingDirectory = cwd === "provider" ? provider.root : resolve(workspace);
  if (action.runner === "command") {
    return [{ command: action.command!, effect: action.effect, cwd, workingDirectory }];
  }
  if (action.runner === "script") {
    const entry = resolveContainedPath(provider.root, action.entry!, "script entry");
    const args = (action.args ?? []).map(shellQuote).join(" ");
    const command = `${runtimeCommand(action.runtime!)} ${shellQuote(entry)}${args ? ` ${args}` : ""}`;
    return [{ command, effect: action.effect, cwd, workingDirectory }];
  }
  if (action.runner === "host") {
    return [{ handler: action.handler!, effect: action.effect, cwd, workingDirectory }];
  }
  return [];
}

export async function resolveRoute(
  provider: LoadedProvider,
  graphId: string,
  entry: string,
  routeId: string,
  input: EvaluationInput = {},
  expectedRevision?: string,
): Promise<Route> {
  const { evaluation, candidates } = evaluateGraph(provider, graphId, entry, input);
  if (expectedRevision !== undefined && evaluation.revision !== expectedRevision) {
    throw new AgentGraphError(
      "route-revision-stale",
      `Expected revision ${expectedRevision}, current revision is ${evaluation.revision}`,
    );
  }
  const candidate = candidates.find((item) => item.routeId === routeId);
  if (!candidate) {
    throw new AgentGraphError("route-stale", `Route ${routeId} is not available at revision ${evaluation.revision}`);
  }
  const resources = await resourcesForCandidate(provider, candidate, evaluation.revision);
  const action = candidate.node.action
    ? provider.actions.get(resolveContainedPath(provider.root, candidate.node.action, "action reference"))
    : undefined;
  return {
    schema: "agent-graph.route.v1",
    provider: provider.manifest.id,
    revision: evaluation.revision,
    routeId: candidate.routeId,
    graph: candidate.graph.definition.id,
    node: candidate.node.id,
    statusCode: candidate.statusCode,
    availability: candidate.availability,
    callPath: candidate.callPath,
    ...(action ? {
      action: {
        id: action.definition.id,
        runner: action.definition.runner,
        effect: action.definition.effect,
      },
    } : {}),
    commandPlan: action ? planForAction(provider, action.definition, input.workspace ?? process.cwd()) : [],
    resources,
    ...(candidate.node.gate ? {
      gate: {
        ...candidate.node.gate,
        resolution: candidate.gateResolution ?? "user",
      },
    } : {}),
    diagnostics: candidate.diagnostics,
    afterAction: {
      evaluate: true,
      recordNode: candidate.stateKey,
    },
  };
}
