import { relativePortable } from "./io.js";
import type { LoadedProvider } from "./types.js";

export function inspectProvider(provider: LoadedProvider) {
  return {
    schema: "agent-graph.inspect.v1",
    provider: {
      id: provider.manifest.id,
      version: provider.manifest.version,
      manifest: provider.manifestPath,
    },
    counts: {
      graphs: provider.graphs.size,
      nodes: [...provider.graphs.values()].reduce((sum, graph) => sum + graph.definition.nodes.length, 0),
      edges: [...provider.graphs.values()].reduce((sum, graph) => sum + graph.definition.edges.length, 0),
      actions: provider.actions.size,
      resources: provider.resources.size,
      codes: provider.codeCatalog?.entries.size ?? 0,
    },
    graphs: [...provider.graphs.values()]
      .map((graph) => ({
        id: graph.definition.id,
        description: graph.definition.description,
        path: relativePortable(provider.root, graph.path),
        entrypoints: graph.definition.entrypoints,
        nodes: graph.definition.nodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          description: node.description,
          ...((node.kind === "action" || node.kind === "gate") ? { reasonCode: node.reasonCode } : {}),
          priority: node.priority ?? 0,
        })),
        dependencies: [...(provider.graphDependencies.get(graph.definition.id) ?? [])].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    actions: [...provider.actions.values()]
      .map((action) => ({
        id: action.definition.id,
        runner: action.definition.runner,
        effect: action.definition.effect,
        path: relativePortable(provider.root, action.path),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    resources: [...provider.resources.values()]
      .map((resource) => ({
        id: resource.metadata.id,
        kind: resource.metadata.kind,
        dynamic: resource.dynamic,
        path: relativePortable(provider.root, resource.path),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    codes: provider.codeCatalog?.definition.codes ?? [],
  };
}
