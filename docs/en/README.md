# Agent Graph user guide

[简体中文](../zh-CN/README.md) · [Project README](../../README.md)

This guide is for Provider authors, Skill authors, Agent-host integrators, and Agents consuming routes.

## Choose your path

- Start a new workflow: [Getting started](./getting-started.md)
- Design nodes, edges, facts, gates, and resources: [Authoring graphs](./authoring.md)
- Understand every protocol object: [Specification](./specification.md)
- Connect Skills, plugins, and multiple Providers: [Skills and Providers](./skills-and-providers.md)
- Use every command: [CLI reference](./cli.md)
- Persist a long task or monitoring loop: [Runtime and recovery](./runtime-and-recovery.md)
- Test and publish a bundle: [Testing and publishing](./testing-and-publishing.md)
- Convert an existing Skill or script workflow: [Migration](./migration.md)
- Understand the design philosophy: [Graph Engineering](./graph-engineering.md)

## The consumption contract

An Agent integrating Agent Graph needs only this loop:

1. Resolve the Provider from the current Skill or an explicit manifest.
2. Run `evaluate` and branch on `statusCode`, not prose.
3. Select the primary route unless the user or task requires an alternative.
4. Run `route` for that exact route ID and Evaluation revision.
5. Read every required resource; read recommended resources only when useful.
6. Do not execute a user gate until it is resolved.
7. Execute only the returned command or host action.
8. Record its explicit outcome and update observable facts where appropriate.
9. Evaluate again. Never continue from memory alone.

The Provider does not need a directory named `agent-graph`. The Skill locator points directly to its manifest, and the host chooses any mutable Run or cache locations.
