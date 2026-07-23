import { dirname, extname, isAbsolute, resolve } from "node:path";
import { AgentGraphError } from "./errors.js";
import {
  ensureFile,
  ensureContainedFile,
  digestFile,
  digestValue,
  listFilesRecursive,
  parseFrontmatter,
  readStaticResourceMetadata,
  readStructuredFile,
  readText,
  resolveContainedPath,
} from "./io.js";
import { validateSchema } from "./schema.js";
import type {
  ActionDefinition,
  BundleManifest,
  CodeCatalogDefinition,
  DynamicResourceDefinition,
  GraphDefinition,
  LoadedAction,
  LoadedCodeCatalog,
  LoadedGraph,
  LoadedProvider,
  LoadedResource,
  ProviderManifest,
  ResolvedSkillBinding,
  SkillBinding,
  StaticFileResourceDefinition,
} from "./types.js";

export type ProviderRegistry = Record<string, string>;

export interface LoadProviderOptions {
  registry?: ProviderRegistry;
}

function validateGraphSemantics(graph: LoadedGraph): void {
  const nodeIds = new Set<string>();
  for (const node of graph.definition.nodes) {
    if (nodeIds.has(node.id)) {
      throw new AgentGraphError("graph-node-duplicate", `Graph ${graph.definition.id} contains duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }
  if (!graph.definition.nodes.some((node) => node.kind === "terminal")) {
    throw new AgentGraphError(
      "graph-terminal-missing",
      `Graph ${graph.definition.id} must declare at least one terminal node`,
    );
  }
  for (const [entry, node] of Object.entries(graph.definition.entrypoints)) {
    if (!nodeIds.has(node)) {
      throw new AgentGraphError("graph-entry-missing", `Graph ${graph.definition.id} entry ${entry} targets missing node ${node}`);
    }
  }
  const edgeKeys = new Set<string>();
  for (const edge of graph.definition.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new AgentGraphError(
        "graph-edge-node-missing",
        `Graph ${graph.definition.id} edge ${edge.from} -> ${edge.to} references a missing node`,
      );
    }
    if (graph.nodeById.get(edge.from)?.kind === "terminal") {
      throw new AgentGraphError(
        "graph-terminal-edge-invalid",
        `Graph ${graph.definition.id} terminal node cannot have outgoing edges: ${edge.from} -> ${edge.to}`,
      );
    }
    const key = `${edge.kind ?? "flow"}:${edge.from}:${edge.to}:${(edge.outcomes ?? ["completed"]).join(",")}`;
    if (edgeKeys.has(key)) {
      throw new AgentGraphError("graph-edge-duplicate", `Graph ${graph.definition.id} contains duplicate edge ${edge.from} -> ${edge.to}`);
    }
    edgeKeys.add(key);
    if (edge.kind === "repeat") {
      const target = graph.nodeById.get(edge.to);
      if (target?.kind !== "action" && target?.kind !== "gate") {
        throw new AgentGraphError(
          "graph-repeat-target-invalid",
          `Graph ${graph.definition.id} repeat edge must target an action or gate: ${edge.from} -> ${edge.to}`,
        );
      }
    }
    if (edge.kind === "gatedBy" && graph.nodeById.get(edge.from)?.kind !== "gate") {
      throw new AgentGraphError(
        "graph-gated-by-source-invalid",
        `Graph ${graph.definition.id} gatedBy edge must start at a gate: ${edge.from} -> ${edge.to}`,
      );
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of graph.definition.edges) {
    if (edge.kind === "repeat") continue;
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string, trail: string[]): void => {
    if (visiting.has(node)) {
      const start = trail.indexOf(node);
      throw new AgentGraphError(
        "graph-flow-cycle",
        `Graph ${graph.definition.id} contains an implicit flow cycle; use a repeat edge: ${[...trail.slice(Math.max(0, start)), node].join(" -> ")}`,
      );
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const target of adjacency.get(node) ?? []) visit(target, [...trail, node]);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of nodeIds) visit(node, []);
}

async function loadGraph(path: string): Promise<LoadedGraph> {
  const definition = await readStructuredFile<GraphDefinition>(path);
  await validateSchema("graph", definition, path);
  const graph: LoadedGraph = {
    path,
    definition,
    nodeById: new Map(definition.nodes.map((node) => [node.id, node])),
  };
  validateGraphSemantics(graph);
  return graph;
}

async function loadAction(providerRoot: string, reference: string): Promise<LoadedAction> {
  const path = resolveContainedPath(providerRoot, reference, "action reference");
  await ensureContainedFile(providerRoot, path, "action");
  const definition = await readStructuredFile<ActionDefinition>(path);
  await validateSchema("action", definition, path);
  return { path, definition };
}

async function actionFiles(providerRoot: string, action: LoadedAction, label: string): Promise<Set<string>> {
  const result = new Set<string>([action.path]);
  for (const reference of [
    action.definition.entry,
    action.definition.inputSchema,
    action.definition.outputSchema,
    ...(action.definition.files ?? []),
  ]) {
    if (!reference) continue;
    const path = resolveContainedPath(providerRoot, reference, label);
    await ensureContainedFile(providerRoot, path, label);
    result.add(path);
  }
  if (action.definition.skill) {
    const skillPath = resolveContainedPath(providerRoot, action.definition.skill, "agent skill reference");
    await ensureContainedFile(providerRoot, skillPath, "agent skill");
    const skillRoot = dirname(skillPath);
    if (skillRoot === providerRoot) result.add(skillPath);
    else for (const file of await listFilesRecursive(skillRoot)) result.add(file);
  }
  return result;
}

async function loadResource(providerRoot: string, reference: string): Promise<LoadedResource> {
  const path = resolveContainedPath(providerRoot, reference, "resource reference");
  await ensureContainedFile(providerRoot, path, "resource");
  const extension = extname(path).toLowerCase();
  if (extension === ".yaml" || extension === ".yml" || extension === ".json") {
    const candidate = await readStructuredFile<unknown>(path);
    if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).schema === "agent-graph.resource.v1") {
      const metadata = candidate as DynamicResourceDefinition | StaticFileResourceDefinition;
      await validateSchema("resource", metadata, path);
      if (metadata.kind === "context-view") return { path, contentPath: path, metadata, dynamic: true };
      const contentPath = resolveContainedPath(providerRoot, metadata.path, "static resource content");
      await ensureContainedFile(providerRoot, contentPath, "static resource content");
      return { path, contentPath, metadata, dynamic: false };
    }
  }
  const metadata = await readStaticResourceMetadata(path);
  return { path, contentPath: path, metadata, dynamic: false };
}

function detectGraphRecursion(dependencies: Map<string, Set<string>>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (graph: string, trail: string[]): void => {
    if (visiting.has(graph)) {
      const cycleStart = trail.indexOf(graph);
      const cycle = [...trail.slice(Math.max(0, cycleStart)), graph];
      throw new AgentGraphError("graph-recursion", `Cross-graph recursion is not allowed: ${cycle.join(" -> ")}`);
    }
    if (visited.has(graph)) return;
    visiting.add(graph);
    for (const child of dependencies.get(graph) ?? []) visit(child, [...trail, graph]);
    visiting.delete(graph);
    visited.add(graph);
  };

  for (const graph of dependencies.keys()) visit(graph, []);
}

async function resolveBundleManifest(path: string): Promise<{ manifestPath: string; bundle?: BundleManifest }> {
  const parsed = await readStructuredFile<{ schema?: unknown }>(path);
  if (parsed.schema !== "agent-graph.bundle.v1") return { manifestPath: path };
  await validateSchema("bundle", parsed, path);
  const bundle = parsed as BundleManifest;
  const { digest, ...unsigned } = bundle;
  if (digestValue(unsigned) !== digest) {
    throw new AgentGraphError("bundle-digest-mismatch", `Bundle manifest digest does not match its content: ${path}`);
  }
  const recordedFiles = new Map<string, string>();
  for (const file of bundle.files) {
    if (recordedFiles.has(file.path)) throw new AgentGraphError("bundle-file-duplicate", `Bundle lists file more than once: ${file.path}`);
    const filePath = resolveContainedPath(dirname(path), file.path, "bundle file");
    await ensureContainedFile(dirname(path), filePath, "bundle file");
    const actual = await digestFile(filePath);
    if (actual !== file.digest) {
      throw new AgentGraphError("bundle-file-digest-mismatch", `Bundle file digest mismatch: ${file.path}`);
    }
    recordedFiles.set(file.path, file.digest);
  }
  for (const catalog of [bundle.graphs, bundle.actions, bundle.resources, bundle.schemas]) {
    for (const item of catalog) {
      if (recordedFiles.get(item.path) !== item.digest) {
        throw new AgentGraphError("bundle-catalog-mismatch", `Bundle catalog entry does not match files: ${item.path}`);
      }
    }
  }
  if (typeof bundle.providerManifest !== "string") {
    throw new AgentGraphError("bundle-invalid", `Bundle ${path} does not declare providerManifest`);
  }
  if (!recordedFiles.has(bundle.providerManifest)) {
    throw new AgentGraphError("bundle-provider-unlisted", `Bundle provider manifest is not listed in files: ${bundle.providerManifest}`);
  }
  return {
    manifestPath: resolveContainedPath(dirname(path), bundle.providerManifest, "bundle provider manifest"),
    bundle,
  };
}

export async function loadProvider(manifestPath: string): Promise<LoadedProvider> {
  const initialPath = resolve(manifestPath);
  await ensureFile(initialPath, "provider manifest");
  const bundleResolution = await resolveBundleManifest(initialPath);
  const resolvedManifestPath = bundleResolution.manifestPath;
  await ensureFile(resolvedManifestPath, "provider manifest");
  const root = dirname(resolvedManifestPath);
  const manifest = await readStructuredFile<ProviderManifest>(resolvedManifestPath);
  await validateSchema("provider", manifest, resolvedManifestPath);
  if (bundleResolution.bundle
    && (bundleResolution.bundle.provider.id !== manifest.id || bundleResolution.bundle.provider.version !== manifest.version)) {
    throw new AgentGraphError(
      "bundle-provider-mismatch",
      `Bundle identifies ${bundleResolution.bundle.provider.id}@${bundleResolution.bundle.provider.version}, but its Provider manifest identifies ${manifest.id}@${manifest.version}`,
    );
  }

  const graphs = new Map<string, LoadedGraph>();
  const actions = new Map<string, LoadedAction>();
  const resources = new Map<string, LoadedResource>();
  const graphFiles = new Map<string, Set<string>>();
  const files = new Set<string>([resolvedManifestPath]);
  const actionIds = new Map<string, string>();
  const resourceIds = new Map<string, string>();
  let codeCatalog: LoadedCodeCatalog | undefined;

  if (manifest.catalogs?.codes) {
    const catalogPath = resolveContainedPath(root, manifest.catalogs.codes, "code catalog reference");
    await ensureContainedFile(root, catalogPath, "code catalog");
    const definition = await readStructuredFile<CodeCatalogDefinition>(catalogPath);
    await validateSchema("code-catalog", definition, catalogPath);
    const entries = new Map<string, CodeCatalogDefinition["codes"][number]>();
    for (const entry of definition.codes) {
      if (entries.has(entry.code)) {
        throw new AgentGraphError("code-catalog-code-duplicate", `Code catalog contains duplicate code: ${entry.code}`);
      }
      entries.set(entry.code, entry);
    }
    codeCatalog = { path: catalogPath, definition, entries, documents: new Map() };
    files.add(catalogPath);
    for (const entry of definition.codes) {
      if (!entry.document) continue;
      const resourcePath = resolveContainedPath(root, entry.document, "code document reference");
      let resource = resources.get(resourcePath);
      if (!resource) {
        resource = await loadResource(root, entry.document);
        const existing = resourceIds.get(resource.metadata.id);
        if (existing && existing !== resource.path) {
          throw new AgentGraphError(
            "resource-id-duplicate",
            `Resource id ${resource.metadata.id} is declared by both ${existing} and ${resource.path}`,
          );
        }
        if (resource.dynamic) {
          throw new AgentGraphError("code-document-dynamic", `Code ${entry.code} must reference a static document resource`);
        }
        resourceIds.set(resource.metadata.id, resource.path);
        resources.set(resource.path, resource);
        files.add(resource.path);
        files.add(resource.contentPath);
      }
      codeCatalog.documents.set(entry.code, resource);
    }
  }

  for (const graphReference of manifest.graphs) {
    const graphPath = resolveContainedPath(root, graphReference, "graph reference");
    await ensureContainedFile(root, graphPath, "graph");
    const graph = await loadGraph(graphPath);
    if (graphs.has(graph.definition.id)) {
      throw new AgentGraphError("graph-id-duplicate", `Provider ${manifest.id} contains duplicate graph id: ${graph.definition.id}`);
    }
    graphs.set(graph.definition.id, graph);
    graphFiles.set(graph.definition.id, new Set([graphPath]));
    files.add(graphPath);
  }

  const graphDependencies = new Map<string, Set<string>>();
  for (const [graphId, graph] of graphs) {
    const dependencies = new Set<string>();
    const directFiles = graphFiles.get(graphId)!;
    for (const node of graph.definition.nodes) {
      if (node.kind === "subgraph") {
        const childId = node.graph!;
        const child = graphs.get(childId);
        if (!child) throw new AgentGraphError("subgraph-missing", `Graph ${graphId} references missing subgraph ${childId}`);
        if (!Object.hasOwn(child.definition.entrypoints, node.entry!)) {
          throw new AgentGraphError("subgraph-entry-missing", `Graph ${graphId} references missing entry ${childId}#${node.entry}`);
        }
        dependencies.add(childId);
      }
      if (node.kind === "action") {
        const actionReference = node.action!;
        const actionPath = resolveContainedPath(root, actionReference, "action reference");
        if (!actions.has(actionPath)) {
          const action = await loadAction(root, actionReference);
          const existing = actionIds.get(action.definition.id);
          if (existing && existing !== action.path) {
            throw new AgentGraphError("action-id-duplicate", `Action id ${action.definition.id} is declared by both ${existing} and ${action.path}`);
          }
          actionIds.set(action.definition.id, action.path);
          actions.set(action.path, action);
        }
        for (const file of await actionFiles(root, actions.get(actionPath)!, "action referenced file")) {
          files.add(file);
          directFiles.add(file);
        }
      }
      const nodeResources = node.kind === "action" || node.kind === "gate" ? node.resources : undefined;
      for (const resourceReference of [
        ...(nodeResources?.required ?? []),
        ...(nodeResources?.recommended ?? []),
      ]) {
        const resourcePath = resolveContainedPath(root, resourceReference, "resource reference");
        if (!resources.has(resourcePath)) {
          const resource = await loadResource(root, resourceReference);
          const existing = resourceIds.get(resource.metadata.id);
          if (existing && existing !== resource.path) {
            throw new AgentGraphError(
              "resource-id-duplicate",
              `Resource id ${resource.metadata.id} is declared by both ${existing} and ${resource.path}`,
            );
          }
          resourceIds.set(resource.metadata.id, resource.path);
          resources.set(resource.path, resource);
          files.add(resource.path);
          files.add(resource.contentPath);
        }
        const resource = resources.get(resourcePath)!;
        directFiles.add(resource.path);
        directFiles.add(resource.contentPath);
      }
    }
    graphDependencies.set(graphId, dependencies);
  }

  detectGraphRecursion(graphDependencies);

  if (codeCatalog) {
    for (const graph of graphs.values()) {
      for (const node of graph.definition.nodes) {
        if (node.kind !== "action" && node.kind !== "gate") continue;
        const entry = codeCatalog.entries.get(node.reasonCode!);
        if (!entry) {
          throw new AgentGraphError(
            "route-reason-code-missing",
            `Graph ${graph.definition.id} node ${node.id} reasonCode is not declared by the Provider code catalog: ${node.reasonCode}`,
          );
        }
        if (entry.kind !== "route-reason") {
          throw new AgentGraphError(
            "route-reason-code-kind-invalid",
            `Graph ${graph.definition.id} node ${node.id} reasonCode must use a route-reason catalog entry: ${node.reasonCode}`,
          );
        }
      }
    }
  }

  for (const resource of resources.values()) {
    if (!resource.dynamic) continue;
    const dynamic = resource.metadata as DynamicResourceDefinition;
    const materializerPath = resolveContainedPath(root, dynamic.materializer, "materializer action reference");
    let action = actions.get(materializerPath);
    if (!action) {
      action = await loadAction(root, dynamic.materializer);
      const existing = actionIds.get(action.definition.id);
      if (existing && existing !== action.path) {
        throw new AgentGraphError("action-id-duplicate", `Action id ${action.definition.id} is declared by both ${existing} and ${action.path}`);
      }
      actionIds.set(action.definition.id, action.path);
      actions.set(materializerPath, action);
      files.add(action.path);
    }
    if (action.definition.effect !== "read") {
      throw new AgentGraphError("materializer-effect-invalid", `Resource materializer ${action.definition.id} must have effect: read`);
    }
    if (action.definition.runner !== "command" && action.definition.runner !== "script") {
      throw new AgentGraphError(
        "materializer-runner-invalid",
        `Resource materializer ${action.definition.id} must use command or script runner`,
      );
    }
    const materializerFiles = await actionFiles(root, action, "materializer referenced file");
    for (const file of materializerFiles) files.add(file);
    for (const directFiles of graphFiles.values()) {
      if (!directFiles.has(resource.path)) continue;
      for (const file of materializerFiles) directFiles.add(file);
    }
  }

  const absoluteFileDigests = await Promise.all([...files]
    .filter((file) => file !== resolvedManifestPath)
    .sort()
    .map(async (file) => [file, await digestFile(file)] as const));
  const digestByFile = new Map(absoluteFileDigests);
  const fileDigests = absoluteFileDigests.map(([file, digest]) => [file.slice(root.length + 1).replaceAll("\\", "/"), digest] as const);
  const closureMemo = new Map<string, Set<string>>();
  const graphClosure = (graphId: string): Set<string> => {
    const cached = closureMemo.get(graphId);
    if (cached) return cached;
    const closure = new Set(graphFiles.get(graphId));
    closureMemo.set(graphId, closure);
    for (const dependency of graphDependencies.get(graphId) ?? []) {
      for (const file of graphClosure(dependency)) closure.add(file);
    }
    return closure;
  };
  const graphDigests = new Map([...graphs.keys()].map((graphId) => {
    const scopedFiles = [...graphClosure(graphId)]
      .sort((left, right) => left.localeCompare(right))
      .map((file) => [file.slice(root.length + 1).replaceAll("\\", "/"), digestByFile.get(file)!]);
    return [graphId, digestValue({ provider: { id: manifest.id, version: manifest.version }, graph: graphId, files: scopedFiles })];
  }));
  if (bundleResolution.bundle) {
    const bundle = bundleResolution.bundle;
    const identities = (entries: Array<{ id: string; path: string }>) => entries
      .map((entry) => `${entry.id}\0${entry.path}`)
      .sort();
    const expectedGraphs = [...graphs.values()].map((graph) => ({ id: graph.definition.id, path: graph.path.slice(root.length + 1).replaceAll("\\", "/") }));
    const expectedActions = [...actions.values()].map((action) => ({ id: action.definition.id, path: action.path.slice(root.length + 1).replaceAll("\\", "/") }));
    const expectedResources = [...resources.values()].map((resource) => ({ id: resource.metadata.id, path: resource.path.slice(root.length + 1).replaceAll("\\", "/") }));
    const schemaPaths = new Map<string, string>();
    for (const action of actions.values()) {
      for (const path of [action.definition.inputSchema, action.definition.outputSchema]) if (path) schemaPaths.set(path, path);
    }
    for (const resource of resources.values()) {
      if (!resource.dynamic && resource.metadata.kind === "schema") {
        schemaPaths.set(resource.contentPath.slice(root.length + 1).replaceAll("\\", "/"), resource.metadata.id);
      }
    }
    const expectedSchemas = [...schemaPaths.entries()].map(([path, id]) => ({ id, path }));
    for (const [label, actual, expected] of [
      ["graphs", bundle.graphs, expectedGraphs],
      ["actions", bundle.actions, expectedActions],
      ["resources", bundle.resources, expectedResources],
      ["schemas", bundle.schemas, expectedSchemas],
    ] as const) {
      if (JSON.stringify(identities(actual)) !== JSON.stringify(identities(expected))) {
        throw new AgentGraphError("bundle-catalog-mismatch", `Bundle ${label} catalog does not match reachable Provider definitions`);
      }
    }
    const expectedFilePaths = [
      bundle.providerManifest,
      ...[...files].filter((file) => file !== resolvedManifestPath).map((file) => file.slice(root.length + 1).replaceAll("\\", "/")),
    ].sort();
    if (JSON.stringify(bundle.files.map((file) => file.path).sort()) !== JSON.stringify(expectedFilePaths)) {
      throw new AgentGraphError("bundle-files-mismatch", "Bundle files do not match the reachable Provider file set");
    }
    const expectedDependencies = Object.fromEntries([...graphDependencies.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, dependencies]) => [id, [...dependencies].sort()]));
    if (digestValue(bundle.graphDependencies) !== digestValue(expectedDependencies)) {
      throw new AgentGraphError("bundle-dependencies-mismatch", "Bundle Graph dependency index does not match Subgraph references");
    }
  }
  const digest = digestValue({ manifest, files: fileDigests });
  return {
    manifestPath: resolvedManifestPath,
    root,
    manifest,
    graphs,
    actions,
    resources,
    ...(codeCatalog ? { codeCatalog } : {}),
    files,
    graphDependencies,
    graphDigests,
    digest,
  };
}

export async function readProviderRegistry(path: string): Promise<ProviderRegistry> {
  const parsed = await readStructuredFile<unknown>(resolve(path));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentGraphError("registry-invalid", `Provider registry must be an object: ${path}`);
  }
  const root = parsed as Record<string, unknown>;
  const candidate = root.providers ?? root;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new AgentGraphError("registry-invalid", `Provider registry providers must be an object: ${path}`);
  }
  const result: ProviderRegistry = {};
  for (const [id, manifest] of Object.entries(candidate as Record<string, unknown>)) {
    if (typeof manifest !== "string") throw new AgentGraphError("registry-invalid", `Provider ${id} must map to a manifest path`);
    result[id] = resolve(dirname(path), manifest);
  }
  return result;
}

export async function readSkillBinding(skillPath: string): Promise<SkillBinding> {
  const absolute = resolve(skillPath);
  const content = await readText(absolute);
  const { metadata } = parseFrontmatter(content, absolute);
  const extensionMetadata = metadata.metadata;
  if (extensionMetadata === null || typeof extensionMetadata !== "object" || Array.isArray(extensionMetadata)) {
    throw new AgentGraphError("skill-binding-missing", `Skill ${absolute} does not declare Agent Graph metadata`);
  }
  const values = extensionMetadata as Record<string, unknown>;
  const locator = values["agent-graph"];
  const graph = values["agent-graph.graph"];
  const entry = values["agent-graph.entry"];
  if (typeof locator !== "string" || locator.trim().length === 0) {
    throw new AgentGraphError("skill-binding-missing", `Skill ${absolute} does not declare metadata.agent-graph`);
  }
  if (typeof graph !== "string" || graph.trim().length === 0) {
    throw new AgentGraphError("skill-binding-missing", `Skill ${absolute} does not declare metadata.agent-graph.graph`);
  }
  if (typeof entry !== "string" || entry.trim().length === 0) {
    throw new AgentGraphError("skill-binding-missing", `Skill ${absolute} does not declare metadata.agent-graph.entry`);
  }
  return { locator: locator.trim(), graph: graph.trim(), entry: entry.trim() };
}

export async function resolveSkillBinding(
  skillPath: string,
  options: LoadProviderOptions = {},
): Promise<ResolvedSkillBinding> {
  const absolute = resolve(skillPath);
  const binding = await readSkillBinding(absolute);
  const locator = binding.locator;
  let manifestPath: string;
  if (locator.startsWith("path:")) {
    const reference = locator.slice("path:".length);
    if (!reference) throw new AgentGraphError("skill-locator-invalid", `Skill path locator is empty: ${absolute}`);
    if (isAbsolute(reference) || /^[A-Za-z]:[\\/]/.test(reference)) {
      throw new AgentGraphError("skill-locator-absolute", `Skill path locator must be relative: ${absolute}`);
    }
    manifestPath = resolve(dirname(absolute), reference);
    await ensureFile(manifestPath, "skill provider manifest");
  } else if (locator.startsWith("provider:")) {
    const id = locator.slice("provider:".length);
    const registered = options.registry?.[id];
    if (!registered) {
      throw new AgentGraphError(
        "provider-unresolved",
        `Provider ${id} is not available; supply a host BundleResolver or --registry`,
      );
    }
    manifestPath = resolve(registered);
  } else {
    throw new AgentGraphError("skill-locator-invalid", `Unsupported agent-graph locator in ${absolute}: ${locator}`);
  }
  await ensureFile(manifestPath, "registered provider manifest");
  const provider = await loadProvider(manifestPath);
  if (locator.startsWith("provider:") && provider.manifest.id !== locator.slice("provider:".length)) {
    throw new AgentGraphError(
      "provider-id-mismatch",
      `Registry key ${locator.slice("provider:".length)} resolved to Provider ${provider.manifest.id}`,
    );
  }
  const graph = provider.graphs.get(binding.graph);
  if (!graph) {
    throw new AgentGraphError("skill-graph-missing", `Skill ${absolute} selects missing Graph ${binding.graph}`);
  }
  if (!Object.hasOwn(graph.definition.entrypoints, binding.entry)) {
    throw new AgentGraphError(
      "skill-entry-missing",
      `Skill ${absolute} selects missing Entry ${binding.graph}#${binding.entry}`,
    );
  }
  return {
    schema: "agent-graph.skill-binding.v1",
    skillPath: absolute,
    locator,
    graph: binding.graph,
    entry: binding.entry,
    manifestPath,
    provider: provider.manifest.id,
  };
}
