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
  catalogs?: {
    codes?: string;
  };
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

interface GraphNodeBase {
  id: string;
  description?: string;
  priority?: number;
  join?: "all" | "any";
  requiresFacts?: FactCheck[];
}

export interface ActionGraphNode extends GraphNodeBase {
  kind: "action";
  reasonCode: string;
  action: string;
  satisfiedBy?: FactCheck[];
  resources?: NodeResources;
}

export interface GateGraphNode extends GraphNodeBase {
  kind: "gate";
  reasonCode: string;
  gate: GateDefinition;
  inspectionAction?: string;
  resolutionAction?: string;
  satisfiedBy?: FactCheck[];
  resources?: NodeResources;
}

export interface SubgraphGraphNode extends GraphNodeBase {
  kind: "subgraph";
  graph: string;
  entry: string;
}

export interface TerminalGraphNode extends GraphNodeBase {
  kind: "terminal";
  terminalOutcome: Outcome;
}

export type RoutableGraphNode = ActionGraphNode | GateGraphNode;
export type GraphNode = ActionGraphNode | GateGraphNode | SubgraphGraphNode | TerminalGraphNode;

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
export type CodeKind = "route-reason" | "diagnostic";

export interface CodeCatalogEntry {
  code: string;
  kind: CodeKind;
  summary: string;
  severity?: Diagnostic["severity"];
  document?: string;
}

export interface CodeCatalogDefinition {
  schema: "agent-graph.code-catalog.v1";
  codes: CodeCatalogEntry[];
}

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

export interface LoadedCodeCatalog {
  path: string;
  definition: CodeCatalogDefinition;
  entries: Map<string, CodeCatalogEntry>;
  documents: Map<string, LoadedResource>;
}

export interface LoadedProvider {
  manifestPath: string;
  root: string;
  manifest: ProviderManifest;
  graphs: Map<string, LoadedGraph>;
  actions: Map<string, LoadedAction>;
  resources: Map<string, LoadedResource>;
  codeCatalog?: LoadedCodeCatalog;
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
  documentRef?: string;
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
  reasonCode: string;
  hint?: string;
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
    resourceId: string;
  };
}

export interface CommandPlanItem {
  command?: string;
  handler?: string;
  effect: "read" | "write" | "external";
  cwd: "workspace" | "provider";
  workingDirectory: string;
}

export interface RouteAction {
  id: string;
  runner: ActionDefinition["runner"];
  effect: ActionDefinition["effect"];
  skill?: ResourceLocation;
  inputSchema?: ResourceLocation;
  outputSchema?: ResourceLocation;
}

export interface Route {
  schema: "agent-graph.route.v1";
  provider: string;
  revision: string;
  routeId: string;
  graph: string;
  node: string;
  statusCode: EvaluationStatus;
  reasonCode: string;
  hint?: string;
  availability: "immediate" | "requires-user" | "blocked";
  callPath: string[];
  action?: RouteAction;
  commandPlan: CommandPlanItem[];
  resources: {
    required: ResourceLocation[];
    recommended: ResourceLocation[];
  };
  gate?: GateDefinition & {
    resolution: "user" | "session-authority";
    inspectionAction?: {
      action: RouteAction;
      commandPlan: CommandPlanItem[];
    };
    resolutionAction?: {
      action: RouteAction;
      commandPlan: CommandPlanItem[];
    };
  };
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
    primaryReasonCode?: string;
    alternativeNodes?: string[];
    availability?: RouteSummary["availability"];
    command?: string;
    handler?: string;
    requiredResources?: string[];
    recommendedResources?: string[];
    gateResolution?: "user" | "session-authority";
    inspectionCommand?: string;
    inspectionHandler?: string;
    inspectionSkill?: string;
    inspectionInputSchema?: string;
    resolutionCommand?: string;
    resolutionHandler?: string;
    resolutionSkill?: string;
    resolutionInputSchema?: string;
    recordNode?: string;
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

export interface SkillBinding {
  locator: string;
  graph: string;
  entry: string;
}

export interface ResolvedSkillBinding extends SkillBinding {
  schema: "agent-graph.skill-binding.v1";
  skillPath: string;
  manifestPath: string;
  provider: string;
}

export interface CodeLocation {
  schema: "agent-graph.code-location.v1";
  provider: string;
  code: string;
  kind: CodeKind;
  summary: string;
  severity?: Diagnostic["severity"];
  document?: ResourceLocation;
}

export interface ErrorEnvelope {
  schema: "agent-graph.error.v1";
  state: "error";
  error: {
    code: string;
    message: string;
    diagnostics: Diagnostic[];
  };
}
