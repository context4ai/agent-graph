# Agent Graph specification v1

This document defines the `agent-graph.*.v1` objects implemented by `@c4a/agent-graph@0.2.3`. The JSON Schemas in [`schemas/`](../../schemas) are normative for file shape; this document defines behavior and invariants.

## 1. Provider

```yaml
schema: agent-graph.provider.v1
id: company/release
version: 0.1.0
graphs:
  - graphs/release.yaml
catalogs:
  codes: codes.yaml
compatibility:
  agentGraph: ^0.2.0
  node: ">=20"
```

A Provider is one independently versioned trust and publication boundary. Its `version` describes that Provider, not the installed `@c4a/agent-graph` package; `compatibility.agentGraph` declares the supported toolchain range.

- `id` identifies the Provider; hosts fully qualify runtime identities with Provider, Graph, and node IDs.
- `version` is semantic-version syntax.
- `graphs` contains Provider-root-relative paths. The loader does not discover graphs by directory scanning.
- references must remain within the Provider root, may not be absolute, and may not escape through a symbolic link.
- multiple Providers remain isolated; v1 does not merge them or permit cross-Provider Subgraphs.

The source manifest may have any filename. A built bundle uses `provider.yaml` plus a generated `manifest.json`.

### 1.1 Skill binding

A graph-enabled Skill binds Provider, Graph, and Entry as one machine contract:

```yaml
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: release
  agent-graph.entry: default
```

`agent-graph` is either a `path:` locator relative to that `SKILL.md` or a host-resolved `provider:` locator. The loader validates all three fields together. These protocol keys intentionally use the project-neutral `agent-graph` namespace; the npm scope is only a package-distribution identity. An integration must not ask the Agent to infer Graph or Entry from prose.

## 2. Graph

```yaml
schema: agent-graph.graph.v1
id: release
entrypoints:
  default: done
nodes:
  - id: done
    kind: terminal
    terminalOutcome: completed
edges: []
```

A Graph is a deterministic route definition. `entrypoints` maps a public entry name to one node. Each node ID is unique within its Graph.

Graph topology is static. Runtime target names, dates, phase IDs, collections, and queue items belong in Facts; a stable Host Action resolves the concrete target. Providers must not rewrite or generate Graph nodes merely because those parameter values changed.

Every Graph must declare at least one Terminal. Terminal nodes cannot have outgoing edges. If one evaluation reaches several Terminals with the same Outcome, the frame completes with that Outcome; conflicting reached Terminal Outcomes produce `terminal-outcome-ambiguous` and an `error` status rather than selecting by declaration order.

### 2.1 Node kinds

| Kind | Required field | Meaning |
|---|---|---|
| `action` | `action` | A Provider-relative Action definition can be selected |
| `gate` | `gate` | User or session authority must resolve a policy boundary |
| `subgraph` | `graph`, `entry` | Enter another Graph in the same Provider |
| `terminal` | `terminalOutcome` | End the frame with an explicit Outcome |

Common node fields:

- `description`: short human label, never a machine condition;
- `reasonCode`: required for Action and Gate nodes; a stable machine explanation beginning with `route.` for selecting that route;
- `priority`: deterministic route ranking within one availability class, never a semantic chooser;
- `join`: `all` requires all incoming edges to match; `any` requires one;
- `requiresFacts`: all checks must pass before the node is legal;
- `satisfiedBy`: observable facts that prove an Action or Gate complete without replaying it;
- `resources.required` and `resources.recommended`: Provider-relative references selected with an Action or Gate.

Runner/node discriminator fields are exclusive. Subgraph and Terminal nodes cannot silently carry Action/Gate resources or satisfaction rules that their execution path would ignore.

### 2.2 Fact checks

Fact checks use a restricted data model, not executable expressions:

```yaml
satisfiedBy:
  - path: artifact.digest
    exists: true
  - path: verification.state
    equals: passed
```

`path` is a dotted lookup. Numeric segments index JSON arrays, so `items.0.digest` addresses the first item's `digest`; other segments address object fields. Each check has exactly one of `exists` or `equals`. Values are scalar JSON values. There is no JavaScript, template expansion, shell evaluation, or arbitrary condition DSL.

When an action has `satisfiedBy`:

- matching facts make it `completed`, even without a Run record;
- a recorded `completed` outcome without matching facts becomes `unverified`;
- an explicit `unverified` edge can route to recovery;
- a claim made in conversation does not create a fact.

Provider integrations are responsible for observing and supplying trustworthy facts. Generic Run facts are host-managed inputs, not automatically external evidence.

### 2.3 Gates and authority

```yaml
kind: gate
reasonCode: route.release.approval-required
gate:
  id: release-approval
  prompt: Approve this release?
  authority: release.approve
  delegatable: true
inspectionAction: actions/inspect-release.yaml
resolutionAction: actions/apply-approval.yaml
delegated:
  inspection: skip
  resolutionAction: actions/accept-release.yaml
  resources: { required: [], recommended: [] }
```

Without matching authority, the route is `waiting-user`. Its ordinary `commandPlan` stays empty. If and only if `delegatable` is true and the current evaluation supplies the named authority, the gate becomes actionable with `resolution: session-authority`.

`inspectionAction` is optional. It references a read-only Provider Action that prepares or opens the evidence needed for the decision. The resolved Route exposes it separately as `gate.inspectionAction`; it remains available while the Gate waits for the user and does not grant authority or resolve the Gate. An inspection Action must use `effect: read`. If it uses the `agent` runner, its Skill is exposed on `gate.inspectionAction.action.skill` instead of being preloaded into the Gate's ordinary `resources.required`.

`resolutionAction` is optional. It references a normal Provider Action that records or applies the decision after the user confirms it. The resolved Route exposes this separately as `gate.resolutionAction`, including its command or Host Handler, Agent Skill, and any input/output Schema locations. A host must not execute or load that conditional work while the Route is `requires-user`; after explicit confirmation, it validates runtime input, loads the Action's Skill when present, executes the action, refreshes observable Facts, and evaluates again. Dynamic decision data belongs in Action input, never in generated Graph nodes.

A resolution Action must have `effect: write` or `external`, because a read-only action cannot resolve the Gate's observable state. A Gate without `resolutionAction` remains valid when the host records its Outcome directly. The Action itself does not grant authority and cannot make a non-delegatable Gate automatic.

The optional `delegated` policy applies only when the Route resolution is `session-authority`. `inspection: skip` suppresses the nested inspection plan for that Route while preserving the authored inspection Action for ordinary user resolution. `resolutionAction` replaces the ordinary resolution Action only on the delegated Route and must also use `effect: write` or `external`. `resources`, when present, replaces the Gate node's ordinary required and recommended Resources for the delegated Route. A Gate declaring this policy must have a delegatable authority; skipping inspection also requires an authored inspection Action. Defaults continue to expose the ordinary inspection, resolution, and Resources.

Authorities belong to the current input or Run. A Provider definition never permanently enables delegated or unattended execution. Authority does not satisfy facts or bypass validation.

### 2.4 Edges

```yaml
- from: inspect
  to: approval
  kind: flow
  outcomes: [completed]
```

All edges define an explicit outcome transition. If `outcomes` is omitted it defaults to `completed`.

| Kind | Semantics |
|---|---|
| `flow` | General control transition |
| `consumes` | The target consumes an artifact produced by the source |
| `requires` | The source is a legal prerequisite for the target |
| `gatedBy` | A Gate source resolves the target's policy boundary |
| `repeat` | A matching result reactivates an action or gate |

Every non-repeat kind uses the same explicit Outcome transition for reachability; the kind preserves causal intent for inspection, testing, and host policy. It does not invent artifact freshness or external proof. Model those with `requiresFacts` and `satisfiedBy`. A `gatedBy` edge must start at a Gate.

Edges do not transport runtime values, artifacts, or shared mutable state. `consumes` records causal intent only. The host must persist an artifact in its own file or object store, then expose an observable reference, digest, or receipt as Facts when downstream legality or completion depends on it.

Non-repeat graphs must be acyclic; loops must be explicit rather than accidental. A `repeat` edge must target an action or gate and resets that target to pending for the next iteration. Event history retains earlier iterations even though the current node outcome is replaced.

Use `join: any` for alternative success paths converging on one node. The default `all` is appropriate for fan-in where every predecessor must succeed.

Fan-out and fan-in are reachability topology, not concurrent execution. Evaluation returns one primary Route plus compact alternatives; Agent Graph does not launch parallel workers or merge their memory.

### 2.5 Subgraphs

A Subgraph target is statically resolved in the same Provider. A child route retains its child Graph/node identity and a parent call path. The complete child Outcome is returned to the parent transition; non-complete states remain visible. Static and runtime recursion into an ancestor Graph are rejected.

V1 does not implement cross-Provider Subgraphs, implicit graph imports, or graph merging.

## 3. Action

```yaml
schema: agent-graph.action.v1
id: inspect-package
runner: command
effect: read
command: npm pack --dry-run
cwd: workspace
```

`effect` is mandatory:

- `read`: intended not to mutate Provider or workspace lifecycle facts;
- `write`: local mutation is expected;
- `external`: external state may change.

Runner contracts:

| Runner | Fields | Route result |
|---|---|---|
| `command` | `command` | Exact shell command metadata |
| `script` | `entry`, `runtime`, optional `args` | Runtime plus absolute installed entry path |
| `agent` | `skill` | The Skill becomes a required file resource |
| `host` | `handler` | Host-defined handler identity |

Runner-specific execution fields are mutually exclusive; a command cannot also declare a Skill or script entry, for example. This prevents a host from choosing a different interpretation of the same Action.

`cwd` is `workspace` by default or `provider`. `inputSchema` and `outputSchema` include schemas in the bundle and their installed locations are exposed on the resolved Route Action. `files` includes additional runtime files used by the action. Script and Skill references are validated and packaged. A Skill in a dedicated directory carries that directory; a Provider-root `SKILL.md` carries only itself, so its supporting files must be explicit.

Agent Graph resolves actions but does not automatically execute them. A product host may build an executor around the same Route contract. For a Host Action, the integration uses the same Facts that produced the Evaluation to resolve current parameters, invokes the stable Handler, refreshes Facts, and evaluates again.

## 4. Resources

### 4.1 Static files

Markdown resources use frontmatter:

```markdown
---
id: release.checklist
kind: procedure
media-type: text/markdown
---
```

Static kinds are `procedure`, `diagnostic`, `template`, `schema`, and `skill`. A resolved location includes an absolute installed path, media type, and content digest. The CLI returns metadata, not the document body.

Markdown can carry its identity in frontmatter. Other file formats use a small descriptor so the file remains valid in its native format:

```yaml
schema: agent-graph.resource.v1
id: schema.draft-output
kind: schema
mediaType: application/schema+json
path: schemas/draft-output.schema.json
```

The descriptor and its target must stay inside the Provider root. Both are included in a built Bundle; the resolved Resource Location points to the target file and uses the target's content digest. This form also supports non-Markdown templates and diagnostics.

Normative instructions belong in procedures; generated or workspace-derived evidence does not.

### 4.2 Dynamic context views

```yaml
schema: agent-graph.resource.v1
id: workspace.status
kind: context-view
mediaType: application/json
materializer: actions/read-status.yaml
```

A context view is data. Its materializer must be a `read` action using a command or script runner. Evaluation and route resolution never run it. A Route-bound dynamic location carries the Route revision. `resource materialize` requires that revision, runs explicitly, writes stdout into a host-selected content-addressed cache, and returns a location plus digest and revision.

The unresolved location exposes only an opaque `{ resourceId }` materialization request plus the Route revision. It does not expose the Provider's descriptor path or materializer command. Product-specific hosts may render the view themselves; Agent Graph does not print the content into the Route.

Materializer processes receive `AGENT_GRAPH_PROVIDER_ROOT`, `AGENT_GRAPH_WORKSPACE`, `AGENT_GRAPH_REVISION`, and JSON `AGENT_GRAPH_INPUT`. By default they inherit only a minimal process environment needed to start common runtimes; SDK hosts may explicitly add variables. They must not emit instructions that override the selected Route.

The reference implementation applies a 30-second timeout, a 10 MiB stdout limit, and a 1 MiB stderr limit by default. SDK options and CLI flags can lower or raise those limits. Exceeding one terminates the process and produces a structured error without writing a cache receipt. `effect: read` is a declared contract for inspection and host policy, not an operating-system sandbox; hosts remain responsible for trusting or isolating materializer code.

### 4.3 Current-conversation read receipts

Route resolution accepts an optional `agent-graph.resource-read-receipts.v1` input:

```json
{
  "schema": "agent-graph.resource-read-receipts.v1",
  "provider": "company/release",
  "receipts": [
    {
      "id": "release.checklist",
      "digest": "sha256:<content-digest>"
    },
    {
      "id": "workspace.status",
      "digest": "sha256:<materialized-content-digest>",
      "revision": "sha256:<selecting-route-revision>"
    }
  ]
}
```

A receipt set is scoped to one Provider and is rejected when used to resolve another Provider. A host may issue a receipt only after the Agent has actually read that exact content and the content remains available in the current conversation. Receipts are ephemeral consumption metadata. They are not Facts, Outcomes, Authorities, completion evidence, or durable Run state, and they do not affect Evaluation revision, Route identity, or Action legality.

Every Resource Location returned by Route resolution, including Action Skills and Schemas, has a `readState`:

- `current`: an exact current-conversation receipt matches;
- `read-required`: no receipt matches, so the Agent must read a required resource before acting.

For a static Resource, a receipt matches the Resource ID and exact content digest. For a dynamic Context View, it matches the Resource ID and selecting Route revision; the receipt digest identifies the materialized content that the host previously exposed. If the workflow revision changes, the dynamic receipt no longer matches. Missing receipts, absent `readState` on a location produced outside Route resolution, or a well-formed but stale receipt all mean `read-required`.

The host is responsible for carrying receipts only within the conversation that still contains the resource. Checkpoint and Run files do not persist them. This avoids repeatedly loading unchanged procedures while preserving refresh boundaries for generated context.

### 4.4 Code Catalog

A Provider may declare one `agent-graph.code-catalog.v1` file:

```yaml
schema: agent-graph.code-catalog.v1
codes:
  - code: route.release.inspect
    kind: route-reason
    summary: The release artifact still needs inspection.
    document: resources/release-checklist.md
```

`route-reason` explains why a Route was selected; `diagnostic` identifies a product condition and may add `severity`. `summary` is a compact hint and never a machine condition. `document` is an optional static Resource, read only when the explanation is needed.

Every `reasonCode` is schema-checked for the `route.<id>` shape even without a Catalog. In this minimal mode, the code remains a machine-stable route reason but has no closed-set spelling check, hint, or document. If a Provider declares a Catalog, every Action and Gate `reasonCode` must resolve to a `route-reason` entry; use a Catalog when the Provider needs closed-set validation or discoverable explanations. A missing Catalog is not a warning because Catalog support is optional by design.

There is no separate `infoCode`: non-blocking information uses a Diagnostic code with `severity: info`.

## 5. Outcomes and evaluation

Outcomes are:

```text
completed partial failed unverified skipped pending blocked waiting-user
```

They are not aliases. In particular, `partial`, `unverified`, and `skipped` must not silently become `completed`.

`agent-graph.evaluation.v1` contains:

- Provider, Graph, and entry identities;
- `revision`, derived from the selected Graph's same-Provider dependency closure plus routing facts, normalized outcomes, and authorities;
- `statusCode`: `actionable`, `waiting-user`, `blocked`, `complete`, or `error`;
- optional terminal Outcome;
- one primary and up to three deterministic alternative route summaries;
- a required `reasonCode` and optional catalog-derived `hint` on each route summary;
- compact diagnostics.

Evaluation is read-only. Same definitions and routing inputs produce the same revision and ordering. Timestamps in outcome records do not affect routing revisions, and a file used only by an unrelated Graph does not invalidate the current Graph's routes. When more alternatives are available, an informational diagnostic reports available and returned counts; the SDK's internal candidate list remains available to a host implementing a dedicated chooser.

## 6. Route

`agent-graph.route.v1` describes exactly one currently legal route:

- current `revision` and revision-bound `routeId`;
- target Graph, node, and Subgraph call path;
- generic `statusCode`, stable `reasonCode`, and optional short `hint`;
- availability, optional Gate resolution, and optional Gate resolution Action;
- action identity and effect;
- command plan or host handler;
- resolved working directory plus its `workspace` or `provider` semantic origin;
- required and recommended resource locations;
- `readState` on each Route Resource, distinguishing current-conversation content from content that must be loaded;
- `afterAction.recordNode` and the requirement to evaluate again.

A route ID is only accepted if it is still available under the supplied state. A caller can bind resolution to the Evaluation revision; a mismatch is rejected before returning a command plan. Long document bodies are never embedded. Dynamic resources return a revision-bound materialization reference rather than running automatically.

## 7. Run

`agent-graph.run.v1` is optional host-owned execution memory. It stores:

- Provider, Graph, entry, and optional workspace;
- facts supplied to routing;
- latest outcome record for each fully qualified state key;
- current session authorities;
- append-only numbered events;
- creation and update timestamps.

A checkpoint is a validated copy of a Run with session authorities removed. Resume copies it to another explicit path, clears authorities again, and appends an event. Checkpoints do not replace fact observation: `satisfiedBy` checks are re-evaluated after resume.

The protocol defines no default global or project directory for mutable state.

## 8. Graph tests

`agent-graph.test.v1` declares an input state and expected status, primary and alternative nodes, reason code, availability, command or handler, selected Resources, Gate resolution, Gate resolution command/handler/input Schema, recording key, terminal Outcome, or diagnostic codes. It does not execute actions or call a model. Test cases are deterministic routing fixtures suitable for CI.

## 9. Build bundle

The deterministic builder:

1. loads and validates all reachable definitions;
2. copies reachable graphs, actions, Skills, resources, schemas, scripts, and declared files;
3. writes a normalized `provider.yaml`;
4. generates catalogs, file digests, and a same-Provider Graph dependency index in `manifest.json`;
5. excludes tests and unrelated files;
6. rejects output that would overwrite referenced sources;
7. rejects a reachable file or generated manifest that contains the source Provider absolute path.

The bundle is relocatable and can itself be loaded through `manifest.json`. Loading rejects not only digest mismatches but also omitted or extra reachable files, incomplete catalogs, mismatched Provider identity, and a dependency index that disagrees with Subgraph references.

## 10. Compatibility and extension policy

Unknown fields are rejected in v1 objects. This prevents misspelled safety fields from being ignored.

Until the npm package reaches `1.0.0`, the `agent-graph.*.v1` family is still in its public draft finalization period. A `0.x` release may tighten a required field or invariant under semantic-versioning rules, but must document the break and update every shipped template, example, and test. `0.2.0` makes Action and Gate `reasonCode` mandatory and completes the Skill binding with explicit Graph and Entry fields.

After the `1.0.0` stability boundary, incompatible new semantics require a new schema version; compatible additions require an explicitly defined extension point. Agent hosts should branch on schema, status codes, reason codes, and diagnostic codes, never on human descriptions.

JSON CLI failures use `agent-graph.error.v1`; automation branches on `error.code`. Error and diagnostic messages remain concise. Detailed interpretation belongs in Provider catalog documents or package manuals, not in an ever-growing error string.
