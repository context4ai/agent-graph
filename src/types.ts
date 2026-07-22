export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const OUTCOMES = [
  "completed",
  "partial",
  "failed",
  "unverified",
  "skipped",
  "pending",
  "blocked",
  "waiting-user",
] as const;

export type Outcome = (typeof OUTCOMES)[number];
export type EvaluationStatus = "actionable" | "waiting-user" | "blocked" | "complete" | "error";

export interface ProviderManifest {
  schema: "agent-graph.provider.v1";
  id: string;
  version: string;
  name?: string;
  description?: string;
  graphs: string[];
  compatibility?: {
    agentGraph?: string;
    node?: string;
  };
}

export interface FactCheck {
  path: string;
  equals?: JsonPrimitive;
  exists?: boolean;
}

export interface NodeResources {
  required?: string[];
  recommended?: string[];
}

export interface GateDefinition {
  id: string;
  prompt: string;
  authority?: string;
  delegatable?: boolean;
}

export interface GraphNode {
  id: string;
  kind: "action" | "gate" | "subgraph" | "terminal";
  description?: string;
  priority?: number;
  join?: "all" | "any";
  action?: string;
  graph?: string;
  entry?: string;
  gate?: GateDefinition;
  terminalOutcome?: Outcome;
  requiresFacts?: FactCheck[];
  satisfiedBy?: FactCheck[];
  resources?: NodeResources;
}

export interface GraphEdge {
  from: string;
  to: string;
  outcomes?: Outcome[];
  kind?: "flow" | "consumes" | "requires" | "gatedBy" | "repeat";
}

export interface GraphDefinition {
  schema: "agent-graph.graph.v1";
  id: string;
  description?: string;
  entrypoints: Record<string, string>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ActionDefinition {
  schema: "agent-graph.action.v1";
  id: string;
  description?: string;
  runner: "command" | "script" | "agent" | "host";
  effect: "read" | "write" | "external";
  command?: string;
  entry?: string;
  runtime?: "node" | "bun" | "python" | "shell";
  handler?: string;
  skill?: string;
  args?: string[];
  files?: string[];
  cwd?: "workspace" | "provider";
  inputSchema?: string;
  outputSchema?: string;
}

export interface DynamicResourceDefinition {
  schema: "agent-graph.resource.v1";
  id: string;
  kind: "context-view";
  mediaType: string;
  materializer: string;
  description?: string;
}

export interface StaticFileResourceDefinition {
  schema: "agent-graph.resource.v1";
  id: string;
  kind: Exclude<ResourceKind, "context-view">;
  mediaType: string;
  path: string;
  description?: string;
}

export type ResourceKind = "procedure" | "diagnostic" | "template" | "schema" | "context-view" | "skill";

export interface StaticResourceMetadata {
  id: string;
  kind: ResourceKind;
  mediaType: string;
}

export interface LoadedGraph {
  path: string;
  definition: GraphDefinition;
  nodeById: Map<string, GraphNode>;
}

export interface LoadedAction {
  path: string;
  definition: ActionDefinition;
}

export interface LoadedResource {
  path: string;
  contentPath: string;
  metadata: StaticResourceMetadata | StaticFileResourceDefinition | DynamicResourceDefinition;
  dynamic: boolean;
}

export interface LoadedProvider {
  manifestPath: string;
  root: string;
  manifest: ProviderManifest;
  graphs: Map<string, LoadedGraph>;
  actions: Map<string, LoadedAction>;
  resources: Map<string, LoadedResource>;
  files: Set<string>;
  graphDependencies: Map<string, Set<string>>;
  graphDigests: Map<string, string>;
  digest: string;
}

export interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
  detail?: JsonValue;
}

export interface OutcomeRecord {
  outcome: Outcome;
  recordedAt: string;
  detail?: JsonValue;
}

export interface RunEvent {
  sequence: number;
  at: string;
  type: string;
  node?: string;
  outcome?: Outcome;
  detail?: JsonValue;
}

export interface RunState {
  schema: "agent-graph.run.v1";
  id: string;
  provider: string;
  graph: string;
  entry: string;
  workspace?: string;
  createdAt: string;
  updatedAt: string;
  facts: Record<string, JsonValue>;
  outcomes: Record<string, OutcomeRecord>;
  authorities: string[];
  events: RunEvent[];
}

export interface EvaluationInput {
  facts?: Record<string, JsonValue>;
  outcomes?: Record<string, Outcome | OutcomeRecord>;
  authorities?: string[];
  runPath?: string;
  workspace?: string;
}

export interface RouteSummary {
  routeId: string;
  graph: string;
  node: string;
  statusCode: EvaluationStatus;
  availability: "immediate" | "requires-user" | "blocked";
  label: string;
}

export interface Evaluation {
  schema: "agent-graph.evaluation.v1";
  provider: string;
  graph: string;
  entry: string;
  revision: string;
  statusCode: EvaluationStatus;
  outcome?: Outcome;
  primaryRoute?: RouteSummary;
  alternativeRoutes: RouteSummary[];
  diagnostics: Diagnostic[];
}

export interface ResourceLocation {
  schema: "agent-graph.resource-location.v1";
  id: string;
  kind: ResourceKind;
  mediaType: string;
  revision?: string;
  digest?: string;
  filePath?: string;
  materialize?: {
    resourcePath: string;
  };
}

export interface CommandPlanItem {
  command?: string;
  handler?: string;
  effect: "read" | "write" | "external";
  cwd: "workspace" | "provider";
  workingDirectory: string;
}

export interface Route {
  schema: "agent-graph.route.v1";
  provider: string;
  revision: string;
  routeId: string;
  graph: string;
  node: string;
  statusCode: EvaluationStatus;
  availability: "immediate" | "requires-user" | "blocked";
  callPath: string[];
  action?: {
    id: string;
    runner: ActionDefinition["runner"];
    effect: ActionDefinition["effect"];
  };
  commandPlan: CommandPlanItem[];
  resources: {
    required: ResourceLocation[];
    recommended: ResourceLocation[];
  };
  gate?: GateDefinition & { resolution: "user" | "session-authority" };
  diagnostics: Diagnostic[];
  afterAction: {
    evaluate: true;
    recordNode?: string;
  };
}

export interface BundleManifestEntry {
  id: string;
  path: string;
  digest: string;
}

export interface BundleManifest {
  schema: "agent-graph.bundle.v1";
  provider: {
    id: string;
    version: string;
  };
  providerManifest: string;
  graphs: BundleManifestEntry[];
  actions: BundleManifestEntry[];
  resources: BundleManifestEntry[];
  schemas: BundleManifestEntry[];
  files: Array<{ path: string; digest: string }>;
  graphDependencies: Record<string, string[]>;
  digest: string;
}

export interface AgentGraphTestCase {
  schema: "agent-graph.test.v1";
  name: string;
  graph: string;
  entry: string;
  state?: {
    facts?: Record<string, JsonValue>;
    outcomes?: Record<string, Outcome | OutcomeRecord>;
    authorities?: string[];
  };
  expect: {
    statusCode: EvaluationStatus;
    primaryNode?: string;
    outcome?: Outcome;
    diagnosticsInclude?: string[];
  };
}

export interface TestCaseResult {
  name: string;
  path: string;
  passed: boolean;
  failures: string[];
}
