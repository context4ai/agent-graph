# Agent Graph user guide

[简体中文](../zh-CN/README.md) · [Project README](../../README.md)

This guide is for Provider authors, Skill authors, Agent-host integrators, and Agents consuming routes. Agent Graph is infrastructure: first identify where it belongs in your Skill or host, then use the technical references for that boundary.

## Choose your path

- Decide whether you are improving a Skill, creating a workflow, embedding a host, or consuming an installed integration: [Adoption paths](./adoption-paths.md)
- Build a first Provider after choosing an adoption path: [Getting started](./getting-started.md)
- Design nodes, edges, facts, gates, and resources: [Authoring graphs](./authoring.md)
- Understand every protocol object: [Specification](./specification.md)
- Connect Skills, plugins, and multiple Providers: [Skills and Providers](./skills-and-providers.md)
- Use every command: [CLI reference](./cli.md)
- Persist a long task or monitoring loop: [Runtime and recovery](./runtime-and-recovery.md)
- Test and publish a bundle: [Testing and publishing](./testing-and-publishing.md)
- Convert an existing Skill or script workflow: [Migration](./migration.md)
- Understand the design philosophy: [Graph Engineering](./graph-engineering.md)
- See a production integration from one thin public Agent entry through replayable Routes: [Context case study](./case-studies/context.md)

## The consumption contract

An Agent consuming an already integrated Agent Graph capability needs only this loop:

1. Resolve Provider, Graph, and Entry from the current Skill binding or use an explicit manifest selection.
2. Run `evaluate` and branch on `statusCode` and `reasonCode`, not prose.
3. Select the primary route unless the user or task requires an alternative.
4. Run `route` for that exact route ID and Evaluation revision.
5. Read every required resource whose `readState` is `read-required`; read recommended resources only when useful.
6. Do not execute a user Gate's separately returned resolution Action until the user confirms it.
7. Execute only the returned command or Host Action.
8. Record its explicit outcome and update observable facts where appropriate.
9. Evaluate again. Never continue from memory alone.

The host may pass resource read receipts from the current conversation to `route`. It must issue a receipt only after the exact content was actually read and remains available to the Agent. Receipts suppress redundant resource reads; they do not replace Facts, Outcomes, or Gates.

The Provider does not need a directory named `agent-graph`. The Skill locator points directly to its manifest, and the host chooses any mutable Run or cache locations.
