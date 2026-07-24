# Contributing to Agent Graph

Thank you for helping improve Agent Graph. Contributions can include bug reports, protocol proposals, documentation, examples, tests, and implementation changes.

## Before opening a pull request

- Use GitHub Discussions for design questions, adoption questions, and ideas that are not yet actionable.
- Search existing Issues and Discussions before opening a new one.
- Open an Issue or Discussion before making a protocol change, adding a public field, or changing compatibility behavior.
- Small documentation fixes and isolated bug fixes can go directly to a pull request.

Security vulnerabilities must not be reported through public Issues. Follow [SECURITY.md](./SECURITY.md).

## Development setup

Agent Graph uses Bun for dependency management, builds, linting, and tests. Runtime code must remain compatible with Node.js 20 and newer.

```bash
git clone https://github.com/context4ai/agent-graph.git
cd agent-graph
bun install
bun run verify
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the source layout, protocol rules, testing principles, and release audit.

## Pull request expectations

A change is ready for review when:

- `bun run verify` passes;
- public TypeScript types and JSON Schemas agree;
- protocol behavior has unit or integration coverage;
- at least one published example covers new protocol behavior;
- English and Simplified Chinese documentation remain behaviorally equivalent;
- runtime code uses standard Node.js APIs rather than Bun-only APIs;
- generated `dist/`, `.tmp/`, coverage, and package archive files are not committed.

Keep pull requests focused. Explain the problem, the chosen behavior, compatibility impact, and how the change was verified.

## Commit messages

Use an English conventional commit with the project version when practical:

```text
feat(v0.3.0): add route inspection metadata
fix(v0.2.2): reject stale evaluation revisions
docs(v0.3.0): clarify provider adoption paths
```

## Review and conduct

Maintainers may ask for changes to preserve protocol portability, deterministic behavior, or documentation parity. Participation in this project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
