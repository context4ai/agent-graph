# CLI reference

## Invocation modes

All modes run the same bundled CLI:

```bash
agent-graph ...                    # installed binary
npx agent-graph@0.1.0 ...         # npm one-shot
bunx agent-graph@0.1.0 ...        # Bun one-shot
node ./agent-graph.mjs ...         # single file shipped by a Provider
```

The single file is built for Node.js 20+. Repository source development uses Bun, but generated Provider actions may declare Node, Bun, Python, or shell runtimes.

## Global options

| Option | Meaning |
|---|---|
| `--manifest <path>` | Source Provider manifest or built bundle manifest; default `provider.yaml` |
| `--skill <path>` | Resolve Provider through this Skill's `metadata.agent-graph` |
| `--registry <path>` | Registry used for `provider:` Skill locators |
| `--format human|json` | Concise terminal output or structured JSON |

When `--skill` is present, its locator selects the Provider. Use compact one-line JSON output for Agent and automation consumption; use `human` or pipe JSON through a formatter for manual inspection.

## Authoring

### `init [directory] --id <id>`

Creates a minimal Provider, agent action, bound Skill, procedure example, and route test. It refuses to replace any path it would generate, even when `provider.yaml` does not exist yet.

### `import skill <SKILL.md> --into <provider-root> [--graph <id>]`

Copies the complete Skill directory, adds a relative Agent Graph binding to the copied Skill, creates an agent Action and Graph, appends it to the Provider, and writes `IMPORT_REPORT.md`.

### `import scripts <files...> --into <provider-root> [--graph <id>]`

Copies scripts and creates a sequential Graph. Runtime is inferred from extension. Effect defaults to `write`; review the generated Action definitions.

### `import workflow <yaml-or-json> --into <provider-root> [--graph <id>]`

Accepts a compact legacy shape:

```yaml
id: release
steps:
  - id: test
    command: npm test
    effect: read
  - id: publish
    command: npm publish
    dependsOn: [test]
    effect: external
```

Dependencies become edges and fan-in uses default `all`. The importer does not invent gates, facts, recovery semantics, or success proofs; `IMPORT_REPORT.md` lists those review gaps.

## Validation and discovery

### `validate`

Loads the complete reachable Provider and returns `valid` or a structured error. It has no action side effects.

### `inspect provider`

Lists Graphs, entries, node counts, dependencies, Actions, Resources, and paths.

### `inspect skill <SKILL.md>`

Shows the locator and resolved Provider. Supply `--registry` for a `provider:` locator.

### `schema list`, `schema path <name>`, and `schema extract <name> --output <path>`

Discover JSON Schema files in an npm installation. Validation schemas are embedded in the standalone CLI; a copied standalone file can write one to an explicit path with `schema extract` even when no public schema directory is present.

## Agent routing

### `evaluate <graph>`

Options:

- `--entry <name>`; default `default`;
- `--state <run.json>`;
- `--facts '<json>'` or `--facts @facts.json`;
- `--outcomes '<json>'` or `--outcomes @outcomes.json`;
- `--authority <id...>`.

`--state` supplies facts, outcomes, and authorities from a Run. Direct values are merged over the Run for the current invocation. Without a Run, use string Outcome values such as `--outcomes '{"release/inspect":"completed"}'`.

### `route <graph> [route-id]`

Uses the same evaluation options. Without `route-id`, resolves the current primary route. Agents should pass `--revision <digest>` from the preceding Evaluation; a changed revision then returns `route-revision-stale`. An unavailable ID returns `route-stale`. Route resolution locates files but never executes commands or materializers.

## Explicit Run management

```text
run start <graph> --state <path>
run status --state <path>
run record <node-key> <outcome> --state <path> [--detail <json>]
run facts --state <path> --set <json> [--replace]
run authority --state <path> [--set <id...>]
run checkpoint --state <path> --to <path>
run resume <checkpoint> --state <path>
run events --state <path>
```

`run status` also needs the Provider options because it re-evaluates the Graph. Mutation-only commands operate on the explicit validated Run file. `run record` uses the fully qualified key returned in `route.afterAction.recordNode`.

## Resources

### `resource locate <id-or-path>`

Returns an installed static file and digest. A dynamic resource returns a materialization reference.

### `resource materialize <id-or-path> --cache <directory> --revision <digest>`

Additional options:

- `--workspace <directory>`; default current directory;
- `--input '<json>'` or `--input @input.json`.

Pass the revision from the Route that selected the context view. Only a read-effect command or script materializer is accepted. The resulting filename is content-addressed. The returned location and cache receipt preserve the selecting revision so a host can reject stale context.

## Tests and build

### `test [file-or-directory]`

Runs all YAML/JSON graph cases recursively. A failed expectation sets a non-zero exit code.

### `build [output]`

Writes a deterministic Provider bundle, by default `dist/provider`. The output may be inside the source tree only when it does not replace referenced source files.

## Error envelope

With `--format json`, failures are written to stderr:

```json
{
  "state": "error",
  "error": {
    "code": "route-stale",
    "message": "...",
    "diagnostics": []
  }
}
```

Automation should branch on `error.code` and diagnostic codes, not message strings.
