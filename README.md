# Agent Graph

Agent Graph brings Graph Engineering to Agent Skills through a context and work orchestration layer. It connects knowledge, instructions, scripts, observable state, and human gates into a navigable work graph so an Agent can discover what matters now, take the next legal action, and keep moving toward a goal.

Agents often have access to enough knowledge. The harder problem is knowing which part applies now, which action is legal next, what proves that action is complete, and where to resume after interruption. A longer prompt does not solve this reliably.

> Context should be discovered, not accumulated. The plan is explicit; the path is selected from current reality.

[简体中文](./README.zh-CN.md) · [User manual](./docs/en/README.md) · [Graph Engineering](./docs/en/graph-engineering.md) · [Development](./DEVELOPMENT.md)

## From knowledge to verified progress

The Graph records the planned boundaries—actions, dependencies, choices, gates, evidence, and recovery paths—without forcing every run through one static pipeline. On each turn, Agent Graph evaluates observable facts and prior outcomes, selects a legal route, and discloses only the resources required by that route:

![Agent Graph route lifecycle](./docs/en/assets/route-lifecycle.svg)

This produces two feedback loops:

- **runtime feedback** changes the next route: success can advance the goal, missing evidence can expose verification, and failure can lead to recovery or another choice;
- **engineering feedback** makes the workflow improvable: events, diagnostics, and route tests reveal where instructions, facts, or graph structure need refinement.

Agent Graph does not silently rewrite its own plan. Runtime routing adapts to evidence; people and engineering processes improve the Graph from observable results.

> Progress should be proven by facts, not remembered from conversation.

## What this makes possible

- **Large knowledge without a giant prompt.** Procedures, schemas, manuals, and generated context remain file resources until a selected route needs them.
- **Long tasks that survive session boundaries.** Facts and explicit outcomes reconstruct where the work is; an optional Run adds events, checkpoints, and resumable operational state.
- **Plans that react without becoming arbitrary.** The Graph defines legal choices and stop conditions, while current evidence determines the path through them.
- **Human and Agent collaboration with visible authority.** Gates state who must decide and whether a user has delegated a decision for the current session.
- **Debugging and testing before model behavior.** Authors can validate references, cycles, resource boundaries, and expected routes without asking a model to execute the workflow.
- **Improvement grounded in evidence.** A team can inspect why a route was chosen, which context it exposed, what outcome was recorded, and where recovery began.

## What the project provides

Agent Graph is a Skills-native file specification with a reference SDK and CLI. The project includes:

- a versioned specification for Providers, Graphs, Actions, Resources, Runs, and tests;
- a Node.js-compatible SDK for loading and evaluating those files;
- a CLI for authoring, inspecting, testing, building, and resuming workflows;
- templates and importers for starting new projects or converting existing Skills, scripts, and dependency workflows.

It is not an Agent framework, model runtime, or hidden task executor. It never calls a model. The CLI exposes the current legal route, required file resources, command plan, gate, and recording contract; an Agent or host decides how to carry out that route.

## Install and run

Run without a permanent installation:

```bash
npx agent-graph@0.1.0 --version
npx agent-graph@0.1.0 init ./my-provider --id my-provider
# Bun users can use the same package without installation:
bunx agent-graph@0.1.0 --version
```

Or install the CLI:

```bash
npm install --global agent-graph@0.1.0
agent-graph --version
```

The package also ships `dist/agent-graph.mjs`, a self-contained portable CLI. Copy that one file and run it with Node.js or Bun:

```bash
node agent-graph.mjs --version
bun agent-graph.mjs --version
```

Node.js 20 or newer is the supported runtime. Bun is used for project development and is optional for users.

## Quick start

```bash
npx agent-graph@0.1.0 init ./my-provider --id my-provider
cd my-provider

npx agent-graph@0.1.0 validate --format json
npx agent-graph@0.1.0 test tests --format json
npx agent-graph@0.1.0 evaluate main --format json
```

`evaluate` returns an `agent-graph.evaluation.v1` envelope. Resolve its `primaryRoute.routeId` to obtain only the action and resources selected for that state:

```bash
npx agent-graph@0.1.0 route main <route-id> --revision <revision> --format json
```

For a resumable task, keep runtime state wherever the host chooses:

```bash
npx agent-graph@0.1.0 run start main --state .runtime/run.json
npx agent-graph@0.1.0 run status --state .runtime/run.json --format json
npx agent-graph@0.1.0 run record main/work completed --state .runtime/run.json
```

Agent Graph does not reserve `.agent-graph`, a home-directory cache, or any host-specific directory. Bundle, runtime, checkpoint, and cache paths are explicit.

## Skill binding

A Skill remains a thin discovery and consumption shell:

```yaml
---
name: example-operator
description: Execute the current route exposed by Agent Graph.
metadata:
  agent-graph: path:../../provider.yaml
---
```

`path:` resolves relative to `SKILL.md`. A host can instead register a shared Provider and use `provider:<id>`. This supports one graph used by several Skills without duplicating graph resources.

## Documentation

- [Getting started](./docs/en/getting-started.md)
- [Authoring graphs](./docs/en/authoring.md)
- [CLI reference](./docs/en/cli.md)
- [Protocol specification](./docs/en/specification.md)
- [Skills and Providers](./docs/en/skills-and-providers.md)
- [Runtime, loops, and recovery](./docs/en/runtime-and-recovery.md)
- [Testing and publishing](./docs/en/testing-and-publishing.md)
- [Migrating existing workflows](./docs/en/migration.md)
- [Graph Engineering: concept and implementation](./docs/en/graph-engineering.md)

Runnable scenarios are under [`examples/`](./examples). Machine-readable contracts are under [`schemas/`](./schemas).
