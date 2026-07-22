# Agent Graph specification v1

This document defines the `agent-graph.*.v1` objects implemented by `agent-graph@0.1.0`. The JSON Schemas in [`schemas/`](../../schemas) are normative for file shape; this document defines behavior and invariants.

## 1. Provider

```yaml
schema: agent-graph.provider.v1
id: company/release
version: 0.1.0
graphs:
  - graphs/release.yaml
compatibility:
  agentGraph: ^0.1.0
  node: ">=20"
```

A Provider is one independently versioned trust and publication boundary.

- `id` identifies the Provider; hosts fully qualify runtime identities with Provider, Graph, and node IDs.
- `version` is semantic-version syntax.
- `graphs` contains Provider-root-relative paths. The loader does not discover graphs by directory scanning.
- references must remain within the Provider root, may not be absolute, and may not escape through a symbolic link.
- multiple Providers remain isolated; v1 does not merge them or permit cross-Provider Subgraphs.

The source manifest may have any filename. A built bundle uses `provider.yaml` plus a generated `manifest.json`.

## 2. Graph

```yaml
schema: agent-graph.graph.v1
id: release
entrypoints:
  default: inspect
nodes: []
edges: []
```

A Graph is a deterministic route definition. `entrypoints` maps a public entry name to one node. Each node ID is unique within its Graph.

### 2.1 Node kinds

| Kind | Required field | Meaning |
|---|---|---|
| `action` | `action` | A Provider-relative Action definition can be selected |
| `gate` | `gate` | User or session authority must resolve a policy boundary |
| `subgraph` | `graph`, `entry` | Enter another Graph in the same Provider |
| `terminal` | `terminalOutcome` | End the frame with an explicit Outcome |

Common node fields:

- `description`: short human label, never a machine condition;
- `priority`: deterministic route ranking within one availability class;
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

`path` is a dotted lookup. Each check has exactly one of `exists` or `equals`. Values are scalar JSON values. There is no JavaScript, template expansion, shell evaluation, or arbitrary condition DSL.

When an action has `satisfiedBy`:

- matching facts make it `completed`, even without a Run record;
- a recorded `completed` outcome without matching facts becomes `unverified`;
- an explicit `unverified` edge can route to recovery;
- a claim made in conversation does not create a fact.

Provider integrations are responsible for observing and supplying trustworthy facts. Generic Run facts are host-managed inputs, not automatically external evidence.

### 2.3 Gates and authority

```yaml
kind: gate
gate:
  id: release-approval
  prompt: Approve this release?
  authority: release.approve
  delegatable: true
```

Without matching authority, the route is `waiting-user` and contains no executable command. If and only if `delegatable` is true and the current evaluation supplies the named authority, the gate becomes actionable with `resolution: session-authority`.

Authorities belong to the current input or Run. A Provider definition never permanently enables managed or unattended operation. Authority does not satisfy facts or bypass validation.

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

Non-repeat graphs must be acyclic; loops must be explicit rather than accidental. A `repeat` edge must target an action or gate and resets that target to pending for the next iteration. Event history retains earlier iterations even though the current node outcome is replaced.

Use `join: any` for alternative success paths converging on one node. The default `all` is appropriate for fan-in where every predecessor must succeed.

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

`cwd` is `workspace` by default or `provider`. `inputSchema` and `outputSchema` include schemas in the bundle. `files` includes additional runtime files used by the action. Script and Skill references are validated and packaged. A Skill in a dedicated directory carries that directory; a Provider-root `SKILL.md` carries only itself, so its supporting files must be explicit.

Agent Graph resolves actions but does not automatically execute them. A product host may build an executor around the same Route contract.

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

Materializer processes receive `AGENT_GRAPH_PROVIDER_ROOT`, `AGENT_GRAPH_WORKSPACE`, `AGENT_GRAPH_REVISION`, and JSON `AGENT_GRAPH_INPUT`. They must not emit instructions that override the selected Route.

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
- compact diagnostics.

Evaluation is read-only. Same definitions and routing inputs produce the same revision and ordering. Timestamps in outcome records do not affect routing revisions, and a file used only by an unrelated Graph does not invalidate the current Graph's routes. When more alternatives are available, an informational diagnostic reports available and returned counts; the SDK's internal candidate list remains available to a host implementing a dedicated chooser.

## 6. Route

`agent-graph.route.v1` describes exactly one currently legal route:

- current `revision` and revision-bound `routeId`;
- target Graph, node, and Subgraph call path;
- availability and optional gate resolution;
- action identity and effect;
- command plan or host handler;
- resolved working directory plus its `workspace` or `provider` semantic origin;
- required and recommended resource locations;
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

`agent-graph.test.v1` declares an input state and expected status, primary node, terminal Outcome, or diagnostic codes. It does not execute actions or call a model. Test cases are deterministic routing fixtures suitable for CI.

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

Unknown fields are rejected in v1 objects. This prevents misspelled safety fields from being ignored. New semantics require a new schema version or an explicitly defined compatible extension point. Agent hosts should branch on schema and status codes, never on human descriptions.
