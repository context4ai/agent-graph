# Authoring graphs

## Source layout

Directory names are conventions, not protocol requirements. References are relative to the Provider manifest directory.

```text
provider.yaml
graphs/
actions/
skills/
resources/
schemas/
tests/
```

The Provider manifest lists Graph files. Graphs reference Action and Resource files. Action files may reference scripts, Skills, and input/output schemas. The loader follows those references and rejects paths that escape the Provider root.

## Nodes

Four node kinds keep control semantics explicit:

- `action`: work performed by a command, script, Agent Skill, or host handler;
- `gate`: a user decision, optionally delegatable through session authority;
- `subgraph`: a call to a named entrypoint in another Graph in the same Provider;
- `terminal`: an explicit graph outcome.

`priority` ranks simultaneously legal routes; it does not decide semantic fitness. Use `requiresFacts` or an explicit preceding Action to make options legal from observable state. `join: all` requires all incoming flow edges; `join: any` accepts any matching incoming edge.

Action and Gate nodes require a stable `reasonCode` beginning with `route.`. It explains why the route is available; it is not a condition. A Code Catalog is optional, but declaring one turns route reasons into a closed, documented set. Keep Graph topology stable and put current targets and other run parameters in Facts. A Host Action can resolve those Facts without creating one node per target.

Skills are loaded at the action that uses them. A primary Agent Action exposes its Skill with the current route resources; a Gate inspection or resolution Agent Action keeps its Skill on that nested action until that phase is selected. This preserves progressive disclosure instead of preloading every possible instruction set.

## Outcomes and edges

An edge matches an explicit outcome. Omitting `outcomes` means `[completed]`.

```yaml
- from: verify
  to: recover
  outcomes: [failed, unverified]
```

Ordinary `flow` edges advance the graph. Use `consumes`, `requires`, and `gatedBy` when the same transition also needs an inspectable causal label. These labels do not replace Fact checks; `gatedBy` must start at a Gate.

Edges carry no artifact or shared state. Persist outputs through the host, then publish stable references, digests, or receipts as Facts. Fan-out and fan-in describe legal reachability; they do not make the CLI execute branches concurrently.

A `repeat` edge explicitly rearms an Action or Gate when its source returns a matching outcome:

```yaml
- from: poll
  to: poll
  kind: repeat
  outcomes: [partial]
```

This expresses an Agent-led loop without making the CLI an automatic scheduler. The Agent performs one route, records `partial`, evaluates again, and receives the same action until it records another outcome. Repeat targets are limited to Action or Gate nodes; recursive cross-Graph calls are rejected.

## Facts versus history

Use `requiresFacts` when a node is legal only under current external state. Use `satisfiedBy` when observed facts can prove the node complete without replaying it.

```yaml
satisfiedBy:
  - path: artifact.digest
    exists: true
```

If a Run says an Action completed but its `satisfiedBy` facts are absent, the evaluator returns `unverified`; it does not treat history as proof. Model facts at the boundary that can actually inspect the system.

Numeric path segments address array items. For example, `artifacts.0.digest` reads the first observed artifact's digest.

## Independent verification pattern

Use a separate read-effect Action when a producer must not verify its own result. Give that Action a host handler, require an observed artifact reference or digest, and use a verification receipt in `satisfiedBy`. A claimed verification without the receipt becomes `unverified` and can repeat or enter recovery.

This is an authoring pattern, not a special node kind: the Provider can declare the boundary, while the host must bind the handler to an independently authorized, read-only verifier. `effect: read` documents intent and supports policy checks; it does not enforce process identity or filesystem isolation. See [`examples/independent-verification`](../../examples/independent-verification).

## Gates and managed sessions

```yaml
kind: gate
reasonCode: route.review.required
gate:
  id: result-review
  prompt: Review the prepared result.
  authority: review
  delegatable: true
inspectionAction: actions/inspect-review.yaml
resolutionAction: actions/apply-review.yaml
```

Without `review` authority, the route requires the user. With that authority in the current evaluation or Run, the route is immediate and identifies `session-authority` as its resolution. Authority belongs to the host-selected session state; it is not written into the Provider and does not prove downstream facts.

Use an optional read-only `inspectionAction` when the host must prepare a report, open a review UI, or fetch decision evidence before asking the user. It is exposed separately from the Gate's ordinary empty `commandPlan` and remains safe to run before confirmation.

Use an optional `resolutionAction` when confirmation alone is not enough and the host must persist a decision or apply structured user input. Keep the Gate prompt short; put the input contract on the Action with `inputSchema`. The waiting Route exposes this Action separately, but it remains conditional until the user confirms. See [`examples/review-gate`](../../examples/review-gate).

## Resources

Place long instructions in Markdown resources with frontmatter:

```yaml
---
id: procedure.prepare
kind: procedure
media-type: text/markdown
---
```

Declare resources on the node that needs them. Required resources must be read before the action; recommended resources are optional. Keep routine CLI envelopes small by returning paths and digests rather than bodies.

For JSON Schema, native templates, or other non-Markdown files, reference the content through a descriptor:

```yaml
schema: agent-graph.resource.v1
id: schema.draft-output
kind: schema
mediaType: application/schema+json
path: schemas/draft-output.schema.json
```

The Route returns the native target file, while the Provider still has a typed Resource identity.

Dynamic context views are YAML/JSON resource descriptors. Their materializer must reference a read-only command or script Action. Materialization happens only through an explicit command and writes to a host-selected cache. The reference runtime enforces configurable time and output limits and does not inherit arbitrary host environment variables by default; the read effect still is not a sandbox.

## Subgraphs

Subgraphs provide control composition within one Provider. A parent declares the child Graph and entrypoint. The child route is returned with a call path, and its terminal outcome flows back to the parent. Static and runtime recursion checks prevent a child from calling an ancestor. Cross-Provider subgraphs are intentionally not supported in v1.
