# Agent Graph

[README](./README.md) · [Development](./DEVELOPMENT.md) · [English manual](./docs/en/README.md) · [中文手册](./docs/zh-CN/README.md)

Agent Graph is an independent open-source project. It defines a Skills-native graph specification and ships a reference SDK and CLI for authoring, validating, testing, building, evaluating, and inspecting agent workflows.

## Engineering rules

- Use Bun for development commands and tests.
- Keep all runtime code Node.js compatible. Bun-only APIs are allowed only in build and test tooling.
- Use ESM and strict TypeScript.
- Keep route consumption agent-led: evaluation and route resolution must not execute model calls or lifecycle Actions; explicit authoring, import, build, Run, and materialization commands may write only to caller-selected paths.
- Treat provider facts and content digests as authoritative. Run history is not proof that external work is complete.
- Do not hard-code Claude, Codex, npm-global, home-directory, or workspace paths into the protocol.
- Long instructions, schemas, templates, and context views remain addressable files; do not inline them into routine CLI output.
- New protocol fields require matching schemas, documentation, tests, and at least one example.
- Keep English and Simplified Chinese user documentation behaviorally equivalent.
- Generated output belongs in `dist/` or `.tmp/` and must not be committed.

## Commands

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run build
bun run verify
```

## Documentation ownership

- `README.md` / `README.zh-CN.md`: product entry and quick start.
- `docs/en/` / `docs/zh-CN/`: user manuals and specification guides.
- `DEVELOPMENT.md`: contributor workflow and release checks.
- Schema files in `schemas/`: machine-readable contracts; prose must not contradict them.
