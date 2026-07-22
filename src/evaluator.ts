import { AgentGraphError } from "./errors.js";
import { digestValue, getFact } from "./io.js";
import type {
  Diagnostic,
  Evaluation,
  EvaluationInput,
  EvaluationStatus,
  FactCheck,
  GraphNode,
  LoadedGraph,
  LoadedProvider,
  Outcome,
  OutcomeRecord,
  RouteSummary,
} from "./types.js";

export interface RouteCandidate {
  routeId: string;
  graph: LoadedGraph;
  node: GraphNode;
  callPath: string[];
  stateKey: string;
  statusCode: EvaluationStatus;
  availability: RouteSummary["availability"];
  diagnostics: Diagnostic[];
  gateResolution?: "user" | "session-authority";
}

interface FrameResult {
  statusCode: EvaluationStatus;
  outcome?: Outcome;
  candidates: RouteCandidate[];
  diagnostics: Diagnostic[];
}

interface EvaluationContext {
  provider: LoadedProvider;
  input: Required<Pick<EvaluationInput, "facts" | "outcomes" | "authorities">> & EvaluationInput;
  revision: string;
}

export interface EvaluatedGraph {
  evaluation: Evaluation;
  candidates: RouteCandidate[];
}

const MAX_ALTERNATIVE_ROUTES = 3;

function factCheckMatches(facts: EvaluationContext["input"]["facts"], check: FactCheck): boolean {
  const value = getFact(facts, check.path);
  if (check.exists !== undefined) return check.exists ? value !== undefined : value === undefined;
  return Object.is(value, check.equals);
}

function allFactsMatch(facts: EvaluationContext["input"]["facts"], checks: FactCheck[] | undefined): boolean {
  return checks === undefined || checks.every((check) => factCheckMatches(facts, check));
}

function frameKey(graphId: string, callPath: string[]): string {
  return callPath.length === 0 ? graphId : `${callPath.join(">")}>${graphId}`;
}

export function nodeStateKey(graphId: string, nodeId: string, callPath: string[] = []): string {
  return `${frameKey(graphId, callPath)}/${nodeId}`;
}

function recordedOutcome(
  outcomes: EvaluationContext["input"]["outcomes"],
  graphId: string,
  nodeId: string,
  callPath: string[],
): Outcome | undefined {
  const value = outcomes[nodeStateKey(graphId, nodeId, callPath)];
  if (typeof value === "string") return value;
  return (value as OutcomeRecord | undefined)?.outcome;
}

function routeId(revision: string, graph: string, node: string, callPath: string[]): string {
  const token = digestValue({ revision, graph, node, callPath }).slice("sha256:".length, "sha256:".length + 20);
  return `route:${token}`;
}

function routeCandidate(
  ctx: EvaluationContext,
  graph: LoadedGraph,
  node: GraphNode,
  callPath: string[],
  statusCode: EvaluationStatus,
  availability: RouteSummary["availability"],
  diagnostics: Diagnostic[] = [],
  gateResolution?: RouteCandidate["gateResolution"],
): RouteCandidate {
  return {
    routeId: routeId(ctx.revision, graph.definition.id, node.id, callPath),
    graph,
    node,
    callPath,
    stateKey: nodeStateKey(graph.definition.id, node.id, callPath),
    statusCode,
    availability,
    diagnostics,
    gateResolution,
  };
}

function routeSummary(candidate: RouteCandidate): RouteSummary {
  return {
    routeId: candidate.routeId,
    graph: candidate.graph.definition.id,
    node: candidate.node.id,
    statusCode: candidate.statusCode,
    availability: candidate.availability,
    label: candidate.node.description ?? candidate.node.id,
  };
}

function candidateRank(candidate: RouteCandidate): [number, number, string] {
  const availabilityRank = candidate.availability === "immediate" ? 0 : candidate.availability === "requires-user" ? 1 : 2;
  return [availabilityRank, -(candidate.node.priority ?? 0), candidate.routeId];
}

function compareCandidates(left: RouteCandidate, right: RouteCandidate): number {
  const a = candidateRank(left);
  const b = candidateRank(right);
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}

function outcomeForSimpleNode(ctx: EvaluationContext, graph: LoadedGraph, node: GraphNode, callPath: string[]): Outcome {
  const recorded = recordedOutcome(ctx.input.outcomes, graph.definition.id, node.id, callPath);
  if (node.satisfiedBy && allFactsMatch(ctx.input.facts, node.satisfiedBy)) return "completed";
  if (node.satisfiedBy && recorded === "completed") return "unverified";
  if (recorded) return recorded;
  if (node.kind === "terminal") return node.terminalOutcome!;
  return "pending";
}

function incomingEdges(graph: LoadedGraph, nodeId: string) {
  return graph.definition.edges.filter((edge) => edge.to === nodeId && edge.kind !== "repeat");
}

function edgeMatches(outcome: Outcome | undefined, outcomes: Outcome[] | undefined): boolean {
  return outcome !== undefined && (outcomes ?? ["completed"]).includes(outcome);
}

function graphStatusForCandidates(candidates: RouteCandidate[], diagnostics: Diagnostic[]): EvaluationStatus {
  if (candidates.some((candidate) => candidate.availability === "immediate")) return "actionable";
  if (candidates.some((candidate) => candidate.availability === "requires-user")) return "waiting-user";
  return diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "blocked" : "blocked";
}

function evaluateFrame(
  ctx: EvaluationContext,
  graph: LoadedGraph,
  entry: string,
  callPath: string[],
  graphStack: string[],
): FrameResult {
  if (graphStack.includes(graph.definition.id)) {
    return {
      statusCode: "error",
      candidates: [],
      diagnostics: [{
        code: "graph-recursion",
        severity: "error",
        message: `Runtime graph recursion detected: ${[...graphStack, graph.definition.id].join(" -> ")}`,
      }],
    };
  }
  const entryNodeId = graph.definition.entrypoints[entry];
  if (!entryNodeId) {
    return {
      statusCode: "error",
      candidates: [],
      diagnostics: [{ code: "entry-missing", severity: "error", message: `Graph ${graph.definition.id} has no entry ${entry}` }],
    };
  }

  const reached = new Set<string>([entryNodeId]);
  const outcomes = new Map<string, Outcome>();
  const childResults = new Map<string, FrameResult>();
  const diagnostics: Diagnostic[] = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (const nodeId of [...reached]) {
      if (outcomes.has(nodeId)) continue;
      const node = graph.nodeById.get(nodeId)!;
      if (!allFactsMatch(ctx.input.facts, node.requiresFacts)) {
        outcomes.set(nodeId, "blocked");
        diagnostics.push({
          code: "required-fact-missing",
          severity: "error",
          message: `Node ${graph.definition.id}/${node.id} requires facts that are not satisfied`,
          path: graph.path,
        });
        changed = true;
        continue;
      }
      if (node.kind === "subgraph") {
        const child = ctx.provider.graphs.get(node.graph!);
        if (!child) {
          outcomes.set(nodeId, "failed");
          diagnostics.push({ code: "subgraph-missing", severity: "error", message: `Missing subgraph ${node.graph}` });
          changed = true;
          continue;
        }
        const childCallPath = [...callPath, `${graph.definition.id}/${node.id}`];
        const childResult = evaluateFrame(ctx, child, node.entry!, childCallPath, [...graphStack, graph.definition.id]);
        childResults.set(nodeId, childResult);
        if (childResult.statusCode === "complete" && childResult.outcome) outcomes.set(nodeId, childResult.outcome);
        else if (childResult.statusCode === "error") outcomes.set(nodeId, "failed");
        else outcomes.set(nodeId, childResult.statusCode === "waiting-user" ? "waiting-user" : "pending");
        changed = true;
        continue;
      }
      outcomes.set(nodeId, outcomeForSimpleNode(ctx, graph, node, callPath));
      changed = true;
    }

    for (const edge of graph.definition.edges) {
      if (edge.kind !== "repeat" || !reached.has(edge.from) || !edgeMatches(outcomes.get(edge.from), edge.outcomes)) continue;
      if (!reached.has(edge.to)) {
        reached.add(edge.to);
        changed = true;
      }
      if (outcomes.get(edge.to) !== "pending") {
        outcomes.set(edge.to, "pending");
        changed = true;
      }
    }

    for (const node of graph.definition.nodes) {
      if (reached.has(node.id)) continue;
      const incoming = incomingEdges(graph, node.id);
      if (incoming.length === 0) continue;
      const matches = incoming.map((edge) => reached.has(edge.from) && edgeMatches(outcomes.get(edge.from), edge.outcomes));
      const eligible = (node.join ?? "all") === "any" ? matches.some(Boolean) : matches.every(Boolean);
      if (eligible) {
        reached.add(node.id);
        changed = true;
      }
    }
  }

  const candidates: RouteCandidate[] = [];
  for (const nodeId of reached) {
    const node = graph.nodeById.get(nodeId)!;
    const outcome = outcomes.get(nodeId);
    if (node.kind === "subgraph") {
      const child = childResults.get(nodeId);
      if (child && child.statusCode !== "complete") {
        candidates.push(...child.candidates);
        diagnostics.push(...child.diagnostics);
      }
      continue;
    }
    if (outcome !== "pending" && outcome !== "waiting-user") continue;
    if (node.kind === "action") {
      candidates.push(routeCandidate(ctx, graph, node, callPath, "actionable", "immediate"));
      continue;
    }
    if (node.kind === "gate") {
      const gate = node.gate!;
      const delegated = gate.delegatable === true && gate.authority !== undefined && ctx.input.authorities.includes(gate.authority);
      candidates.push(routeCandidate(
        ctx,
        graph,
        node,
        callPath,
        delegated ? "actionable" : "waiting-user",
        delegated ? "immediate" : "requires-user",
        [],
        delegated ? "session-authority" : "user",
      ));
    }
  }

  const reachedTerminals = [...reached]
    .map((id) => graph.nodeById.get(id)!)
    .filter((node) => node.kind === "terminal")
    .map((node) => outcomes.get(node.id))
    .filter((outcome): outcome is Outcome => outcome !== undefined);

  if (reachedTerminals.length > 0) {
    return { statusCode: "complete", outcome: reachedTerminals[0], candidates: [], diagnostics };
  }
  candidates.sort(compareCandidates);
  if (candidates.length > 0) {
    return { statusCode: graphStatusForCandidates(candidates, diagnostics), candidates, diagnostics };
  }
  if (diagnostics.length === 0) {
    diagnostics.push({
      code: "no-route",
      severity: "error",
      message: `Graph ${graph.definition.id} cannot reach a terminal or actionable node from entry ${entry}`,
    });
  }
  return { statusCode: "blocked", candidates: [], diagnostics };
}

function normalizedInput(input: EvaluationInput): EvaluationContext["input"] {
  return {
    ...input,
    facts: input.facts ?? {},
    outcomes: input.outcomes ?? {},
    authorities: [...new Set(input.authorities ?? [])].sort(),
  };
}

export function computeRevision(
  provider: LoadedProvider,
  graphId: string,
  entry: string,
  input: EvaluationInput,
): string {
  const outcomes = Object.fromEntries(Object.entries(input.outcomes ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, typeof value === "string" ? value : value.outcome]));
  return digestValue({
    provider: provider.graphDigests.get(graphId) ?? provider.digest,
    graphId,
    entry,
    facts: input.facts ?? {},
    outcomes,
    authorities: [...new Set(input.authorities ?? [])].sort(),
  });
}

export function evaluateGraph(
  provider: LoadedProvider,
  graphId: string,
  entry = "default",
  input: EvaluationInput = {},
): EvaluatedGraph {
  const graph = provider.graphs.get(graphId);
  if (!graph) throw new AgentGraphError("graph-missing", `Provider ${provider.manifest.id} has no graph ${graphId}`);
  const normalized = normalizedInput(input);
  const revision = computeRevision(provider, graphId, entry, normalized);
  const context: EvaluationContext = { provider, input: normalized, revision };
  const result = evaluateFrame(context, graph, entry, [], []);
  const [primary, ...alternatives] = result.candidates;
  const diagnostics = [...result.diagnostics];
  if (alternatives.length > MAX_ALTERNATIVE_ROUTES) {
    diagnostics.push({
      code: "route-alternatives-truncated",
      severity: "info",
      message: `Evaluation returned ${MAX_ALTERNATIVE_ROUTES} of ${alternatives.length} alternative routes`,
      detail: { available: alternatives.length, returned: MAX_ALTERNATIVE_ROUTES },
    });
  }
  const evaluation: Evaluation = {
    schema: "agent-graph.evaluation.v1",
    provider: provider.manifest.id,
    graph: graphId,
    entry,
    revision,
    statusCode: result.statusCode,
    ...(result.outcome ? { outcome: result.outcome } : {}),
    ...(primary ? { primaryRoute: routeSummary(primary) } : {}),
    alternativeRoutes: alternatives.slice(0, MAX_ALTERNATIVE_ROUTES).map(routeSummary),
    diagnostics,
  };
  return { evaluation, candidates: result.candidates };
}
