import { resolve } from "node:path";

import { AgentGraphError } from "./errors.js";
import { evaluateGraph, type RouteCandidate } from "./evaluator.js";
import { digestFile, parseFrontmatter, readText, resolveContainedPath } from "./io.js";
import { validateSchema } from "./schema.js";
import type {
  ActionDefinition,
  CodeLocation,
  DynamicResourceDefinition,
  EvaluationInput,
  LoadedProvider,
  LoadedAction,
  LoadedResource,
  ResourceLocation,
  ResourceReadReceiptSet,
  Route,
  RouteAction,
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

function dynamicLocation(metadata: DynamicResourceDefinition, revision?: string): ResourceLocation {
  return {
    schema: "agent-graph.resource-location.v1",
    id: metadata.id,
    kind: metadata.kind,
    mediaType: metadata.mediaType,
    ...(revision ? { revision } : {}),
    materialize: { resourceId: metadata.id },
  };
}

async function locateLoadedResource(resource: LoadedResource, revision?: string): Promise<ResourceLocation> {
  return resource.dynamic
    ? dynamicLocation(resource.metadata as DynamicResourceDefinition, revision)
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

async function locateActionSchema(
  provider: LoadedProvider,
  action: ActionDefinition,
  direction: "input" | "output",
): Promise<ResourceLocation | undefined> {
  const reference = direction === "input" ? action.inputSchema : action.outputSchema;
  if (!reference) return undefined;
  const path = resolveContainedPath(provider.root, reference, `${direction} schema reference`);
  return staticLocation(path, {
    id: `schema.${action.id}.${direction}`,
    kind: "schema",
    mediaType: "application/schema+json",
  });
}

async function routeAction(
  provider: LoadedProvider,
  action: ActionDefinition,
  receiptSet?: ResourceReadReceiptSet,
): Promise<RouteAction> {
  const skill = action.runner === "agent" && action.skill
    ? await locateSkill(provider, action.skill)
    : undefined;
  const inputSchema = await locateActionSchema(provider, action, "input");
  const outputSchema = await locateActionSchema(provider, action, "output");
  return {
    id: action.id,
    runner: action.runner,
    effect: action.effect,
    ...(skill ? { skill: annotateReadState([skill], receiptSet)[0]! } : {}),
    ...(inputSchema ? { inputSchema: annotateReadState([inputSchema], receiptSet)[0]! } : {}),
    ...(outputSchema ? { outputSchema: annotateReadState([outputSchema], receiptSet)[0]! } : {}),
  };
}

function referencedAction(
  provider: LoadedProvider,
  reference: string | undefined,
): LoadedAction | undefined {
  return reference
    ? provider.actions.get(resolveContainedPath(provider.root, reference, "action reference"))
    : undefined;
}

export async function locateResource(provider: LoadedProvider, referenceOrId: string, revision?: string): Promise<ResourceLocation> {
  const byId = [...provider.resources.values()].find((resource) => resource.metadata.id === referenceOrId);
  if (byId) return locateLoadedResource(byId, revision);
  const directPath = resolveContainedPath(provider.root, referenceOrId, "resource reference");
  const byPath = provider.resources.get(directPath);
  if (byPath) return locateLoadedResource(byPath, revision);
  throw new AgentGraphError("resource-missing", `Provider ${provider.manifest.id} has no resource ${referenceOrId}`);
}

export async function locateCode(provider: LoadedProvider, code: string): Promise<CodeLocation> {
  const entry = provider.codeCatalog?.entries.get(code);
  if (!entry) throw new AgentGraphError("code-missing", `Provider ${provider.manifest.id} has no catalog entry for ${code}`);
  const resource = provider.codeCatalog?.documents.get(code);
  const document = resource ? await locateLoadedResource(resource) : undefined;
  return {
    schema: "agent-graph.code-location.v1",
    provider: provider.manifest.id,
    code: entry.code,
    kind: entry.kind,
    summary: entry.summary,
    ...(entry.severity ? { severity: entry.severity } : {}),
    ...(document ? { document } : {}),
  };
}

async function resourcesForCandidate(provider: LoadedProvider, candidate: RouteCandidate, revision: string) {
  const selectedResources = candidate.node.kind === "gate" &&
      candidate.gateResolution === "session-authority" &&
      candidate.node.delegated?.resources !== undefined
    ? candidate.node.delegated.resources
    : candidate.node.resources;
  const requiredReferences = [...(selectedResources?.required ?? [])];
  const recommendedReferences = [...(selectedResources?.recommended ?? [])];
  const action = candidate.node.kind === "action"
    ? referencedAction(provider, candidate.node.action)
    : undefined;
  const required = await Promise.all(requiredReferences.map((reference) => locateResource(provider, reference, revision)));
  const recommended = await Promise.all(recommendedReferences.map((reference) => locateResource(provider, reference, revision)));
  if (action?.definition.runner === "agent" && action.definition.skill) {
    required.unshift(await locateSkill(provider, action.definition.skill));
  }
  return { required, recommended };
}

function hasCurrentReceipt(location: ResourceLocation, receiptSet: ResourceReadReceiptSet | undefined): boolean {
  if (!receiptSet) return false;
  return receiptSet.receipts.some((receipt) => {
    if (receipt.id !== location.id) return false;
    if (location.materialize) {
      return location.revision !== undefined && receipt.revision === location.revision;
    }
    return location.digest !== undefined && receipt.digest === location.digest;
  });
}

function annotateReadState(
  locations: ResourceLocation[],
  receiptSet: ResourceReadReceiptSet | undefined,
): ResourceLocation[] {
  return locations.map((location) => ({
    ...location,
    readState: hasCurrentReceipt(location, receiptSet) ? "current" : "read-required",
  }));
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
  if (input.resourceReceipts) {
    await validateSchema("resource-read-receipts", input.resourceReceipts, "resourceReceipts");
    if (input.resourceReceipts.provider !== provider.manifest.id) {
      throw new AgentGraphError(
        "resource-receipts-provider-mismatch",
        `Resource receipts target Provider ${input.resourceReceipts.provider}, current Provider is ${provider.manifest.id}`,
      );
    }
  }
  const locatedResources = await resourcesForCandidate(provider, candidate, evaluation.revision);
  const resources = {
    required: annotateReadState(locatedResources.required, input.resourceReceipts),
    recommended: annotateReadState(locatedResources.recommended, input.resourceReceipts),
  };
  const action = candidate.node.kind === "action"
    ? referencedAction(provider, candidate.node.action)
    : undefined;
  const inspectionAction = candidate.node.kind === "gate" && !(
      candidate.gateResolution === "session-authority" &&
      candidate.node.delegated?.inspection === "skip"
    )
    ? referencedAction(provider, candidate.node.inspectionAction)
    : undefined;
  const resolutionAction = candidate.node.kind === "gate"
    ? referencedAction(
        provider,
        candidate.gateResolution === "session-authority" &&
            candidate.node.delegated?.resolutionAction !== undefined
          ? candidate.node.delegated.resolutionAction
          : candidate.node.resolutionAction,
      )
    : undefined;
  const workspace = input.workspace ?? process.cwd();
  return {
    schema: "agent-graph.route.v1",
    provider: provider.manifest.id,
    revision: evaluation.revision,
    routeId: candidate.routeId,
    graph: candidate.graph.definition.id,
    node: candidate.node.id,
    statusCode: candidate.statusCode,
    reasonCode: candidate.reasonCode,
    ...(candidate.hint ? { hint: candidate.hint } : {}),
    availability: candidate.availability,
    callPath: candidate.callPath,
    ...(action ? {
      action: await routeAction(provider, action.definition, input.resourceReceipts),
    } : {}),
    commandPlan: action ? planForAction(provider, action.definition, workspace) : [],
    resources,
    ...(candidate.node.kind === "gate" ? {
      gate: {
        ...candidate.node.gate,
        resolution: candidate.gateResolution ?? "user",
        ...(inspectionAction ? {
          inspectionAction: {
            action: await routeAction(provider, inspectionAction.definition, input.resourceReceipts),
            commandPlan: planForAction(provider, inspectionAction.definition, workspace),
          },
        } : {}),
        ...(resolutionAction ? {
          resolutionAction: {
            action: await routeAction(provider, resolutionAction.definition, input.resourceReceipts),
            commandPlan: planForAction(provider, resolutionAction.definition, workspace),
          },
        } : {}),
      },
    } : {}),
    diagnostics: candidate.diagnostics,
    afterAction: {
      evaluate: true,
      recordNode: candidate.stateKey,
    },
  };
}
