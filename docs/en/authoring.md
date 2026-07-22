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

`priority` selects among simultaneously available routes. `join: all` requires all incoming flow edges; `join: any` accepts any matching incoming edge.

## Outcomes and edges

An edge matches an explicit outcome. Omitting `outcomes` means `[completed]`.

```yaml
- from: verify
  to: recover
  outcomes: [failed, unverified]
```

Ordinary `flow` edges advance the graph. Use `consumes`, `requires`, and `gatedBy` when the same transition also needs an inspectable causal label. These labels do not replace Fact checks; `gatedBy` must start at a Gate.

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

## Gates and managed sessions

```yaml
kind: gate
gate:
  id: result-review
  prompt: Review the prepared result.
  authority: review
  delegatable: true
```

Without `review` authority, the route requires the user. With that authority in the current evaluation or Run, the route is immediate and identifies `session-authority` as its resolution. Authority belongs to the host-selected session state; it is not written into the Provider and does not prove downstream facts.

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

Dynamic context views are YAML/JSON resource descriptors. Their materializer must reference a read-only command or script Action. Materialization happens only through an explicit command and writes to a host-selected cache.

## Subgraphs

Subgraphs provide control composition within one Provider. A parent declares the child Graph and entrypoint. The child route is returned with a call path, and its terminal outcome flows back to the parent. Static and runtime recursion checks prevent a child from calling an ancestor. Cross-Provider subgraphs are intentionally not supported in v0.1.
