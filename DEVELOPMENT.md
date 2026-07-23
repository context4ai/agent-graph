# Development

This document is for contributors to the `agent-graph` toolchain. Product usage belongs in the [English](./docs/en/README.md) and [Chinese](./docs/zh-CN/README.md) user guides. Repository-wide Agent rules live in [AGENTS.md](./AGENTS.md).

## Requirements

- Bun 1.3 or later for dependency management, tests, and builds;
- Node.js 20 or later for validating runtime compatibility;
- Git for source control.

```bash
bun install
bun run verify
```

## Source layout

```text
src/          SDK, evaluator, loader, router, stores, builder, importer, CLI
schemas/      public JSON Schema contracts
templates/    copyable Provider and import templates
examples/     executable, domain-neutral integration fixtures
tests/unit/   isolated behavior tests
tests/integration/ CLI, build, import, registry, and examples
docs/en/      English user manual
docs/zh-CN/   Simplified Chinese user manual
scripts/      repository build tooling
dist/         generated npm output
```

## Runtime and build boundary

Runtime files under `src/` use standard Node.js APIs. Bun-only APIs are allowed in `scripts/` and tests. The build emits:

- `dist/index.js`: bundled ESM SDK;
- `dist/types/index.d.ts`: SDK declarations;
- `dist/agent-graph.mjs`: self-contained npm executable and portable CLI file.

Public validation schemas are embedded into the JavaScript bundles for standalone operation and also published as files for tooling and editor integration.

## Development loop

```bash
bun run typecheck
bun run lint
bun run test:unit
bun run test:integration
bun run build
node dist/agent-graph.mjs --version
```

Use `.tmp/` for manual fixtures. Do not add generated `dist/`, `.tmp/`, or `node_modules/` content to Git.

## Changing the protocol

A protocol change is complete only when all of the following agree:

1. TypeScript public types;
2. public JSON Schema;
3. loader/evaluator/router behavior;
4. an example using the behavior;
5. unit and integration coverage;
6. English and Chinese specification/manual text;
7. deterministic build behavior where relevant.

V1 schemas use `additionalProperties: false`. Add new semantics deliberately; do not hide them in free-form metadata or description strings.

## Testing principles

- Unit tests may use isolated temporary directories.
- Integration tests execute all published examples.
- The built CLI is exercised through Node, not only through Bun source execution.
- One integration test copies `agent-graph.mjs` away from the package and validates a Provider.
- Import tests use generic fixtures and must not encode a customer or business workflow.
- Tests must not invoke model services or rely on network access.
- Dynamic resource fixtures must be read-only and write only to explicit temporary caches.

## Documentation

README files provide positioning, installation, and navigation. User behavior belongs in `docs/{lang}`. DEVELOPMENT describes contribution mechanics. AGENTS contains stable repository constraints, not a duplicate manual.

When adding a document, add its counterpart in the other language and link it from both manual indexes when it is user-facing.

Mermaid diagrams use a light neutral palette with orange only as an accent. Keep diagrams readable on a white page and avoid embedding dark-theme-only colors.

## Release audit

```bash
bun run verify
npm pack --dry-run
```

Then test the produced tarball in a clean temporary prefix:

1. install the tarball without a workspace link;
2. run `agent-graph --version`;
3. initialize and validate a Provider;
4. run the installed SDK under Node;
5. run the binary through npm/npx-style package resolution;
6. inspect tarball contents for LICENSE, metadata, docs, schemas, templates, and path leaks.

Do not publish from a dirty or unreviewed working tree. Package releases follow semantic versioning; Provider manifests are independently versioned by their authors.
