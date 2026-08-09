# Adoption paths

Agent Graph becomes useful as part of a Skill or Agent host. It is not a workflow that appears merely because the CLI is installed.

Use this page to identify the integration boundary before choosing commands or file layouts.

## Improve an existing Skill

Choose this path when a Skill already works but has grown into a long instruction file, repeats context on every turn, loses its place across sessions, or relies on prose to describe gates and recovery.

The target shape is:

- the Skill keeps its `name`, `description`, and a short route-consumption contract;
- a Provider owns stable Actions, Graphs, gates, reason codes, and tests;
- phase-specific manuals, schemas, and diagnostics become Resources selected by Routes;
- the host supplies current Facts and stores any mutable Run state;
- `satisfiedBy` identifies facts that prove completion instead of trusting a conversational claim.

Do not translate every paragraph into a node. A node should represent a state transition that is independently actionable, gated, recoverable, or testable. Supporting explanation remains a Resource.

The importer can copy an existing Skill and create a valid starting Provider. It cannot infer business facts, safe effects, human authority, or recovery semantics. Review the generated draft before replacing the original Skill.

Next:

- [Migrating existing Skills and workflows](./migration.md)
- [Skills and Providers](./skills-and-providers.md)
- [`examples/facts-recovery`](../../examples/facts-recovery)

## Create a new Skill or workflow

Choose this path when the capability does not exist yet and its operating contract can be designed with the Skill.

Start with the stable work model rather than a list of commands:

1. identify the Facts the host can actually observe;
2. define legal Actions and their effects;
3. state what proves each Action complete;
4. add user Gates where authority matters;
5. make failure, partial work, verification, and recovery explicit;
6. attach long instructions only to the Routes that need them;
7. write graph cases for important states and choices;
8. bind one or more thin Skills to the relevant Graph and Entry.

Current module names, document IDs, dates, queue entries, and similar runtime targets remain Facts. A stable Host Action resolves the current target; the Provider does not regenerate its Graph for each item.

Next:

- [Technical tutorial](./getting-started.md)
- [Authoring graphs](./authoring.md)
- [Testing and publishing](./testing-and-publishing.md)
- [`examples/fact-driven-batch`](../../examples/fact-driven-batch)

## Embed Agent Graph in a hosted CLI, plugin, or product

Choose this path when a product already owns Agent discovery, command execution, UI, workspace state, or plugin installation. Agent Graph should be embedded behind that product boundary instead of exposed as another end-user CLI.

The responsibilities are deliberately split:

| Component | Responsibility |
|---|---|
| Skill | Advertise when the capability applies and bind Provider, Graph, and Entry |
| Provider bundle | Define static legal work, Resources, gates, reason codes, and route tests |
| Host | Resolve bundles, collect Facts, persist state, materialize dynamic Resources, execute Host Actions, enforce Gates, and refresh observations |
| Agent | Consume the selected Route, read required Resources marked `read-required`, perform delegated work, and report an explicit Outcome |
| Agent Graph | Validate contracts and deterministically evaluate and resolve Routes |

During development, keep source Provider files beside the product or plugin that owns them. At build time, produce a relocatable bundle and include it in that product's normal resource packaging. At runtime, the host resolves a Skill binding or registry ID to the installed bundle.

The host loop is:

1. resolve the current Skill binding;
2. observe Facts from the product's source of truth;
3. evaluate the bound Graph and Entry;
4. resolve one Route using the returned route ID and revision;
5. expose required file Resources to the Agent;
6. execute a returned command or dispatch a stable Host Handler;
7. enforce unresolved user Gates before mutation;
8. refresh Facts, record an Outcome when appropriate, and evaluate again.

Use the SDK for an in-process Node.js host. Use the JSON CLI when the host is implemented in another runtime or needs a process boundary. Both consume the same file protocol; neither should become the source of product Facts.

Long manuals and generated context should remain files. Static Resources resolve to file locations and digests. Dynamic context views are explicitly materialized into a cache selected by the host. Do not copy those bodies into Skill metadata or routine status output.

Next:

- [Skills and Providers](./skills-and-providers.md)
- [Protocol specification](./specification.md)
- [Runtime and recovery](./runtime-and-recovery.md)
- [`examples/shared-provider`](../../examples/shared-provider)
- [`examples/provider-registry`](../../examples/provider-registry)

## Use an existing integration

Choose this path when a CLI, plugin, or product already ships graph-enabled Skills.

The end user or Agent normally invokes the Skill through that host. The host resolves its Provider and supplies the current Route. A separate global Agent Graph installation, copied Provider, or shared `.agent-graph` directory is not required.

The consuming Agent needs only the route loop:

- branch on machine codes, not incidental prose;
- read every required Resource marked `read-required`;
- treat recommended Resources as optional;
- stop at unresolved user Gates;
- perform only the selected Action;
- report an explicit Outcome and evaluate again.

See the [Agent consumption contract](./README.md#the-consumption-contract).

## Repository and installation shape

Agent Graph does not prescribe one directory name. The binding or host registry points to a Provider wherever the owner packages it.

Common shapes include:

- a Provider beside one Skill inside a repository;
- one Provider shared by several Skills in a plugin;
- a bundled Provider embedded in a hosted CLI;
- several independent Provider bundles resolved by a product registry.

Mutable Runs and dynamic-resource caches belong to the host's existing runtime area, database, or temporary storage. They do not belong in a published Skill or Provider bundle.
