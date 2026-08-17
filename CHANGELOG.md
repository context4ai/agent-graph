# Changelog

All notable changes to Agent Graph are documented here. The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.2.4 - 2026-08-17

- Expanded the Context case study with direct links to its Provider, workspace Graph, Actions, Resources, reason-code catalog, and route tests.
- Added per-step Action and on-demand Resource inspection to the interactive replay.
- Added a bilingual visual map of the complete Context `workspace.yaml` work contract.
- Clarified how two thin Skills can consume 25 Action contracts and 57 independently addressable resources through verifiable progressive disclosure.

## 0.2.3 - 2026-08-09

- Added current-conversation resource read receipts for progressive context reuse.
- Marked routed resources as `current` or `read-required` without changing route evaluation.
- Invalidated dynamic context-view receipts when their selecting workflow revision changes.
- Added the public receipt schema, CLI input, examples, documentation, and regression coverage.

## 0.2.2 - 2026-07-27

- Added read-only Gate inspection Actions for evidence preparation before a decision.
- Exposed inspection plans separately from post-confirmation resolution plans.
- Kept Gate Action Skills attached to their execution phase for progressive disclosure.
- Added schema, loader, route, example, and graph-test coverage for Gate inspection.

## 0.2.1 - 2026-07-24

- Added explicit gate resolution Actions.
- Required gate resolution Actions to be capable of changing observable state.
- Exposed the post-confirmation resolution Action through the CLI route contract.

## 0.2.0 - 2026-07-23

- Added fact-grounded routing contracts and catalog-backed route reasons.
- Clarified when a Skill should adopt an Agent Graph.
- Expanded provider, routing, and host integration documentation.

## 0.1.1 - 2026-07-22

- Hardened work graph validation and materialization boundaries.
- Added explicit run state, recovery, and standalone CLI coverage.

## 0.1.0 - 2026-07-22

- Published the initial Agent Graph specification, SDK, CLI, schemas, templates, examples, and test suite.
