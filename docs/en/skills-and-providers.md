# Skills and Providers

## Agent Skills remain the entry contract

Agent Graph extends Agent Skills; it does not replace them. A graph-enabled Skill should remain useful to a host during discovery: its `name` and `description` explain when to invoke it, while one metadata value tells the integration where graph behavior lives.

```yaml
---
name: release-package
description: Inspect, review, and release a package through the installed workflow.
metadata:
  agent-graph: path:../../release-graph/provider.yaml
---
```

The Skill body should contain only the bootstrap contract:

1. identify the Graph and entry to use;
2. evaluate before taking lifecycle action;
3. resolve the selected Route;
4. read required route resources completely;
5. treat recommended resources as optional context;
6. stop for unresolved user gates;
7. record the explicit Outcome and evaluate again.

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

Several Skills may share one Provider and choose different Graphs or entries in their bodies. The graph files, procedures, and schemas remain single-source. One Provider may also contain several Graphs that share Action or Resource definitions.

Sharing an Action or Resource does not create an execution dependency. Only explicit edges, fact requirements, and Subgraph nodes do.

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
  resolveSkillManifest,
} from "agent-graph";

const { manifestPath } = await resolveSkillManifest(skillPath, { registry });
const provider = await loadProvider(manifestPath);
const { evaluation } = evaluateGraph(provider, graphId, entry, currentState);

if (evaluation.primaryRoute) {
  const route = await resolveRoute(
    provider,
    graphId,
    entry,
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
| Provider discovery | `readSkillLocator`, `resolveSkillManifest`, `readProviderRegistry`, `loadProvider` |
| Routing | `evaluateGraph`, `computeRevision`, `resolveRoute`, `nodeStateKey` |
| Resources | `locateResource`, `materializeResource` |
| Optional Run files | `createRun`, `loadRun`, `recordOutcome`, `updateRunFacts`, `updateRunAuthorities`, `checkpointRun`, `resumeRun` |
| Authoring | `initProvider`, `importSkill`, `importScripts`, `importWorkflow` |
| Quality and release | `validateSchema`, `runGraphTests`, `buildProviderBundle`, `inspectProvider` |

All filesystem paths returned by the SDK are resolved paths for the current installation. Definitions inside a Provider remain relative. Evaluation and route resolution are side-effect free; only explicitly named authoring, Run mutation, build, and materialization APIs write files.

`materializeResource` accepts `timeoutMs`, `maxOutputBytes`, and `maxErrorBytes` guardrails. Materializers inherit a minimal environment; a trusted host may explicitly pass additional variables with `env`. Agent Graph variables override names supplied through that option.
