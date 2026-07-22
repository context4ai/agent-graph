# Getting started

## 1. Create a Provider

```bash
npx @c4a/agent-graph@0.1.1 init ./example-provider --id example-provider
cd example-provider
```

The generated tree contains a Provider manifest, one Graph, one Action, one thin Skill, one procedure resource, and one graph test. No runtime directory is generated. A host may choose an ignored location such as `.agent-graph-runtime/`, but the protocol does not reserve it.

## 2. Validate and test

```bash
npx @c4a/agent-graph@0.1.1 validate --format json
npx @c4a/agent-graph@0.1.1 test tests --format json
```

Validation checks JSON Schemas, relative-path containment, IDs, references, graph entrypoints, explicit terminals, edge endpoints, subgraph calls, cross-graph recursion, dynamic resource materializers, and duplicate identities. It does not execute actions.

## 3. Discover the current route

```bash
npx @c4a/agent-graph@0.1.1 evaluate main --format json
```

The result contains a stable status code, a revision digest, a primary route, alternatives, and concise diagnostics. It does not inline Skill or procedure bodies.

Resolve the selected route:

```bash
npx @c4a/agent-graph@0.1.1 route main <route-id> --revision <revision> --format json
```

Pass both values from the same Evaluation. If graph inputs or relevant Provider files change between evaluation and resolution, the CLI rejects the stale revision instead of returning a mismatched plan.

The route contains:

- one selected node and its call path;
- a command or host-handler plan when applicable;
- required and recommended resource locations;
- an optional gate;
- the state key to record after acting.

Static resources are returned as files with content digests. Dynamic context views return a materialization descriptor and must be explicitly materialized.

## 4. Use a Run for a long task

```bash
npx @c4a/agent-graph@0.1.1 run start main \
  --state ./runtime/run.json \
  --workspace "$PWD"

npx @c4a/agent-graph@0.1.1 run status \
  --manifest ./provider.yaml \
  --state ./runtime/run.json \
  --format json
```

After performing the route, use the exact `afterAction.recordNode` state key:

```bash
npx @c4a/agent-graph@0.1.1 run record main/work completed \
  --state ./runtime/run.json
```

Then evaluate again. A historical `completed` outcome does not override a missing fact check; the graph may expose verification or recovery instead.

## 5. Build a relocatable bundle

```bash
npx @c4a/agent-graph@0.1.1 build ./dist/provider --format json
node ./path/to/agent-graph.mjs --manifest ./dist/provider/manifest.json validate
```

The bundle copies only reachable provider files, writes normalized provider metadata, records content digests, generates the graph-dependency index, and contains no source-machine absolute paths.
