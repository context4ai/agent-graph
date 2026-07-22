# Testing and publishing

## Test behavior, not prose

A graph case supplies facts, outcomes, and authorities and asserts the evaluated contract:

```yaml
schema: agent-graph.test.v1
name: missing proof routes to verification
graph: build
entry: default
state:
  outcomes:
    build/package: completed
expect:
  statusCode: actionable
  primaryNode: verify-artifact
```

Assertions may cover `statusCode`, `primaryNode`, terminal `outcome`, and required diagnostic codes. They do not execute commands or call an Agent, so they remain fast and deterministic.
An empty or missing test path is an error rather than a vacuous pass.

## Recommended case matrix

For each production Graph, cover:

- initial route;
- deterministic primary/alternative ranking and compact route truncation;
- every branch Outcome;
- user gate and explicitly delegated gate;
- missing required facts;
- fact-backed completion;
- claimed completion without proof (`unverified`);
- partial and failed batch recovery;
- `join: all` and `join: any` behavior where used;
- repeat continuation and terminal stopping;
- Subgraph child route and parent continuation;
- any diagnostic expected to block execution.

Static validation separately tests missing files, duplicate IDs, invalid paths, missing Subgraph entries, invalid repeat targets, and recursion.

## Commands

```bash
agent-graph validate --manifest provider.yaml
agent-graph test tests --manifest provider.yaml
agent-graph build dist/provider --manifest provider.yaml
agent-graph validate --manifest dist/provider/manifest.json
```

Run these in CI before packaging the product that carries the Provider.

## Deterministic bundle contents

`build` copies only runtime-reachable files:

- Provider Graphs;
- referenced Actions;
- action entry, input/output Schema, and declared `files`;
- dedicated directories of referenced Agent Skills, or an explicit root Skill plus its declared files;
- static Resource definitions and their native content files;
- dynamic Resource definitions;
- dynamic materializer Actions and files.

Tests and unrelated authoring files remain outside the Bundle. Generated `manifest.json` records catalogs, every copied file digest, same-Provider Graph dependencies, and an overall digest. It has no timestamp, so unchanged inputs produce the same manifest.

Loading a built `manifest.json` verifies the overall manifest digest, every listed file digest, Provider identity, catalog and file-set completeness, Graph dependency indexes, and the listed Provider manifest before graph evaluation.

## Publishing with npm

This repository publishes the toolchain itself:

```bash
bun run verify
npm pack --dry-run
npm publish
```

Provider projects may instead depend on `agent-graph` and publish their built bundle in their own package. They may also copy `dist/agent-graph.mjs` beside the bundle for a no-install CLI entry. The copied CLI validates and routes on Node.js 20+; it is not a second implementation.

For reproducible automation, pin the one-shot version:

```bash
npx @c4a/agent-graph@0.1.1 --manifest ./provider.yaml validate
```

## Package audit checklist

Before release, verify:

1. `package.json` name, version, license, repository, exports, and bin are correct;
2. the tarball contains LICENSE, README, docs, public schemas, templates, SDK, and executable CLI;
3. `node dist/agent-graph.mjs --version` succeeds;
4. the CLI copied by itself can validate a Provider;
5. an installed SDK can import `loadProvider`, `evaluateGraph`, and `resolveRoute`;
6. no source-machine absolute path appears in the tarball or generated bundle metadata;
7. built Provider digests match installed files;
8. `path:` Skill bindings still resolve after relocation;
9. `provider:` bindings resolve through a clean registry;
10. dynamic materialization writes only to the explicit cache;
11. tests contain no credentials, business data, or machine-specific paths.

## Source, link, pack, and registry parity

The same Provider should return the same graph/action/resource identities in all installation modes. Absolute `filePath` values differ because the BundleResolver selects the installed location. Route IDs are revision-bound: relevant definition or routing-input changes produce a new revision and new route IDs.

## Security boundary

Validation proves structural integrity, not that an arbitrary command is safe. Provider authors and installation hosts must review Action commands, effects, scripts, and resources as executable supply-chain content. `external` effects should normally sit behind an explicit gate or product policy.
