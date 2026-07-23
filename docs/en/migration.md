# Migrating existing Skills and workflows

Import creates a draft; it cannot infer business or safety semantics from file order alone.

## Package contract changes in 0.2.0

`0.2.0` is a pre-1.0 contract-tightening release:

- an Action or Gate node must declare a `route.*` `reasonCode`;
- a Skill binding uses `agent-graph`, `agent-graph.graph`, and `agent-graph.entry` to select Provider, Graph, and Entry explicitly;
- Providers that declare a Code Catalog receive closed-set validation for every route reason.

Update all three Skill metadata fields and validate every Provider before adopting the new runtime. Provider manifest versions remain independent from the `@c4a/agent-graph` package version.

## Existing Agent Skill

```bash
agent-graph init ./provider --id product-workflow
agent-graph import skill ../legacy-skill/SKILL.md \
  --into ./provider \
  --graph legacy-capability
agent-graph validate --manifest ./provider/provider.yaml
```

The importer copies the complete Skill directory, adds a relative Provider/Graph/Entry binding to the copied `SKILL.md`, and creates one agent Action and Graph. It preserves the original instructions but does not split them into guessed phases.

After import, review:

- which operations are separate actions;
- which resources are required only for one route;
- effects (`read`, `write`, `external`);
- human gates and whether delegation is permitted;
- facts that prove success;
- failure, partial, unverified, and recovery transitions;
- stopping conditions for repeated work.

## Ordered scripts

```bash
agent-graph import scripts ./inspect.sh ./package.sh \
  --into ./provider \
  --graph package-flow
```

Scripts become a sequential Graph. File extensions select Node, Bun, Python, or shell. The importer cannot know whether a script is actually read-only or external, so generated effects must be reviewed.

## Dependency workflow

```bash
agent-graph import workflow ./workflow.yaml --into ./provider
```

The compact importer validates step shapes, missing dependencies, normalized ID collisions, and dependency cycles before writing. It preserves commands and `dependsOn` relationships, including fan-out and fan-in reachability, adds a deterministic start action for multiple roots, and places a terminal after all leaves. This topology does not imply parallel execution: Agent Graph selects one primary Route at a time. The importer does not evaluate templating, arbitrary workflow expressions, secrets, matrix expansion, or vendor-specific retry policies.

## `IMPORT_REPORT.md`

Every import appends its own section to the report beside `provider.yaml`. Import refuses to replace an existing generated Graph, Action, script directory, or copied Skill. Treat the report as an authoring checklist, not a runtime resource. It intentionally calls out semantics that must not be guessed. Resolve those gaps in Graph, Action, Resource, and test files, then remove or archive the report according to the Provider repository policy.

## Migrating a large Skill safely

1. Import without changing the source Skill.
2. Validate the generated Provider.
3. Add one graph case matching the current happy path.
4. Extract deterministic commands into Action files.
5. Move long phase-specific instructions into route resources.
6. Add facts and `satisfiedBy` before trusting recorded success.
7. Add explicit gates and failure/recovery Outcomes.
8. Add loop tests if work can repeat.
9. Build and test the relocatable bundle.
10. Only then replace the original Skill with a thinner bound entry.

Do not translate every paragraph into a node. Nodes represent independently actionable, gated, recoverable, or testable state transitions. Supporting explanation remains a file resource.
