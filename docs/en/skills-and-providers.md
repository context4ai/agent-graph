# Skills and Providers

## Agent Skills remain the entry contract

Agent Graph extends Agent Skills; it does not replace them. A graph-enabled Skill should remain useful to a host during discovery: its `name` and `description` explain when to invoke it, while three namespaced metadata values form one complete machine binding.

```yaml
---
name: release-package
description: Inspect, review, and release a package through the installed workflow.
metadata:
  agent-graph: path:../../release-graph/provider.yaml
  agent-graph.graph: release
  agent-graph.entry: default
---
```

The Skill body should contain only the bootstrap contract:

1. evaluate the bound Graph and Entry before taking lifecycle action;
2. resolve the selected Route;
3. read required route resources marked `read-required` completely;
4. treat recommended resources as optional context;
5. stop for unresolved user gates;
6. record the explicit Outcome and evaluate again.

Do not copy all graph phases, diagnostics, schemas, or generated workspace context into the Skill.

## Locator syntax

### `path:`

`path:<relative-path>` is resolved from the directory containing that exact `SKILL.md`, never from process cwd. The path points directly to a source Provider manifest or built `manifest.json`.

```text
plugin/
├── skills/
│   ├── init/SKILL.md       ───┐
│   └── continue/SKILL.md   ───┼── path:../../product-workflow/provider.yaml
└── product-workflow/          │
    ├── provider.yaml       <──┘
    ├── graphs/
    ├── actions/
    └── resources/
```

The Provider directory may be called anything. Relative references must not escape the Provider root once loading begins.

### `provider:`

`provider:<id>` delegates location to a host registry or BundleResolver:

```yaml
metadata:
  agent-graph: provider:company/release
  agent-graph.graph: release
  agent-graph.entry: default
```

CLI registry example:

```yaml
providers:
  company/release: ../installed/release/manifest.json
```

```bash
agent-graph inspect skill ./skills/release/SKILL.md --registry ./providers.yaml
```

The registry file belongs to the host. It must not be generated into every consumer project, and a Skill must not hard-code npm prefixes, plugin cache versions, or developer machine paths.

## One Provider, many Skills and Graphs

Several Skills may share one Provider and select different Graphs or Entries in their metadata. The loader validates Provider, Graph, and Entry together; the Agent never infers this machine choice from prose. Graph files, procedures, and schemas remain single-source. One Provider may also contain several Graphs that share Action or Resource definitions.

Sharing an Action or Resource does not create an execution dependency. Only explicit edges, fact requirements, and Subgraph nodes do.

## Static Graphs, dynamic Facts

A Graph describes stable work categories and possible states. It should not create one node per current module, document, date, phase, or queue item. Those values belong in Facts.

A stable host Action is the boundary between the Graph and product-specific parameters:

```yaml
schema: agent-graph.action.v1
id: process-next
runner: host
effect: write
handler: batch.process-next
```

The integration host invokes `batch.process-next` with the same current Facts used for evaluation and resolves the concrete target there. After execution it refreshes Facts and evaluates again. See [`examples/fact-driven-batch`](../../examples/fact-driven-batch).

## Multiple Providers in one host

When two installed Skills point to different Providers:

- identities and mutable state stay separated by Provider ID;
- manifests and Graphs are not merged;
- the current Skill selects its own Provider;
- a host without Skill context must require an explicit Provider choice;
- v1 cannot call a Subgraph in another Provider.

This avoids a central `.agent-graph` manifest that every plugin would need to mutate. Each plugin publishes its own bundle; the host registry only resolves identities.

## Host-owned locations

Three location concerns are intentionally separate:

| Concern | Reference implementation | Host decision |
|---|---|---|
| Bundle resolution | `path:` or registry-backed `provider:` | npm package, plugin cache, repository, embedded resource |
| Run storage | explicit `--state` and checkpoint paths | project runtime area, database, memory, existing product store |
| Dynamic resource cache | explicit `--cache` | temporary directory, content store, existing product cache |

Agent Graph does not require `~/.agent-graph`, `.agent-graph`, `.claude/agent-graph`, or `.codex/agent-graph`.

## Thin host integration pseudocode

```ts
import {
  evaluateGraph,
  loadProvider,
  resolveRoute,
  resolveSkillBinding,
} from "@c4a/agent-graph";

const binding = await resolveSkillBinding(skillPath, { registry });
const provider = await loadProvider(binding.manifestPath);
const { evaluation } = evaluateGraph(provider, binding.graph, binding.entry, currentState);

if (evaluation.primaryRoute) {
  const route = await resolveRoute(
    provider,
    binding.graph,
    binding.entry,
    evaluation.primaryRoute.routeId,
    currentState,
    evaluation.revision,
  );
  // Present route resources and action to the Agent. Do not execute implicitly.
}
```

See [`examples/shared-provider`](../../examples/shared-provider) and [`examples/provider-registry`](../../examples/provider-registry).

## SDK surface by responsibility

| Responsibility | APIs |
|---|---|
| Provider discovery | `readSkillBinding`, `resolveSkillBinding`, `readProviderRegistry`, `loadProvider` |
| Routing | `evaluateGraph`, `computeRevision`, `resolveRoute`, `nodeStateKey` |
| Resources and codes | `locateResource`, `materializeResource`, `locateCode` |
| Optional Run files | `createRun`, `loadRun`, `recordOutcome`, `updateRunFacts`, `updateRunAuthorities`, `checkpointRun`, `resumeRun` |
| Authoring | `initProvider`, `importSkill`, `importScripts`, `importWorkflow` |
| Quality and release | `validateSchema`, `runGraphTests`, `buildProviderBundle`, `inspectProvider` |

All filesystem paths returned by the SDK are resolved paths for the current installation. Definitions inside a Provider remain relative. Evaluation and route resolution are side-effect free; only explicitly named authoring, Run mutation, build, and materialization APIs write files.

`materializeResource` accepts `timeoutMs`, `maxOutputBytes`, and `maxErrorBytes` guardrails. Materializers inherit a minimal environment; a trusted host may explicitly pass additional variables with `env`. Agent Graph variables override names supplied through that option.
