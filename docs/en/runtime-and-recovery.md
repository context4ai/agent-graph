# Runtime, loops, and recovery

## Stateless evaluation first

Prefer Provider facts when a workflow can be reconstructed from the real system. Supply them directly:

```bash
agent-graph evaluate build \
  --manifest provider.yaml \
  --facts @observed-facts.json \
  --format json
```

Facts such as an artifact digest, source revision, test receipt, or deployed version survive process restarts and can invalidate stale work. A statement in Agent conversation is not an observed fact.

Use a Run only when you need execution history, a long task checkpoint, explicit non-observable outcomes, or repeated iterations. Run start, checkpoint, and resume refuse to replace an existing target path; choose a new path or remove an obsolete file explicitly.

## Run lifecycle

```bash
agent-graph run start monitor \
  --manifest provider.yaml \
  --state .runtime/monitor.json \
  --workspace .

agent-graph run status --manifest provider.yaml --state .runtime/monitor.json
agent-graph route monitor --manifest provider.yaml --state .runtime/monitor.json --format json
```

After an action, use the exact `afterAction.recordNode` key:

```bash
agent-graph run record monitor/poll partial --state .runtime/monitor.json
agent-graph run status --manifest provider.yaml --state .runtime/monitor.json
```

Events are append-only and outcomes keep only the latest record per state key. This supports a compact current state while retaining an audit trail of iterations.

## Repeat loops

```yaml
nodes:
  - id: poll
    kind: action
    action: actions/poll.yaml
  - id: done
    kind: terminal
    terminalOutcome: completed
edges:
  - from: poll
    to: poll
    kind: repeat
    outcomes: [partial]
  - from: poll
    to: done
    outcomes: [completed]
```

Recording `partial` reactivates `poll`; recording `completed` reaches the terminal. A repeat edge must target an action or gate. The CLI does not busy-wait, sleep, or run the loop itself: the Agent or product host chooses when to execute each route and may stop according to its own time or budget policy.

Model retry policy, process retry, and workflow Outcome are different concerns. Do not map an exhausted transport retry to `completed`; normally record `failed` or `unverified` and route to recovery.

## Partial failure and recovery

Use explicit outcomes and edges:

```yaml
edges:
  - from: verify
    to: done
    outcomes: [completed]
  - from: verify
    to: repair
    outcomes: [failed, unverified]
```

Use `partial` when some required work succeeded and some did not. Counts or detailed receipts belong in Run event details or Provider facts; route logic still uses explicit Outcome and fact checks. Never filter failed items and report the remainder as a complete batch.

For a result that must be externally provable, add `satisfiedBy`. A recorded success that lacks its proof becomes `unverified`, allowing deterministic recovery after a crash or handoff.

## Checkpoint and resume

```bash
agent-graph run checkpoint \
  --state .runtime/monitor.json \
  --to .runtime/checkpoints/before-handoff.json

agent-graph run resume .runtime/checkpoints/before-handoff.json \
  --state .runtime/resumed.json
```

Checkpoint creation strips session authorities. Resume preserves facts, outcomes, and events, clears authorities again defensively, then re-evaluates against current Provider definitions. Authority must be explicitly granted again. This prevents a checkpoint from becoming permanent unattended-mode configuration.

Provider facts may also have changed while paused. The host should refresh them before evaluation. A checkpoint is execution memory, not an immutable truth anchor.

## Session authority

Authority can be supplied directly to one evaluation:

```bash
agent-graph route release \
  --manifest provider.yaml \
  --state .runtime/release.json \
  --authority release.approve
```

Or a host may set it on a Run for the duration of the host-defined session:

```bash
agent-graph run authority --state .runtime/release.json --set release.approve
```

The host is responsible for clearing it when the user's explicit managed-session instruction ends. `run resume` clears it automatically. Authority only resolves a `delegatable` gate and never bypasses fact checks, schema validation, verification, or non-delegatable gates.

## Dynamic resource guardrails

Dynamic context materialization executes Provider code only when the host explicitly asks for it. The reference runtime defaults to a 30-second timeout, a 10 MiB stdout limit, and a 1 MiB stderr limit. CLI flags or SDK options can adjust these limits. A timeout or output overflow terminates the materializer and does not create a cache receipt.

Materializers receive only the Agent Graph variables plus a minimal inherited environment needed to start common runtimes. SDK hosts can explicitly inject additional variables for a trusted integration. Do not assume `effect: read` is a sandbox: it is declarative metadata, and the host must isolate untrusted Provider code with its own process, container, permission, and secret policy.

## Storage ownership

The CLI accepts exact paths so the host can choose:

- a product's existing runtime directory;
- a workspace-local ignored directory;
- a durable task store;
- a temporary location for a short run.

Provider bundles are read-only. Run and checkpoint files are durable only if the host chooses durable paths. Materialized resources are cache entries and must be reproducible after deletion.

See [`examples/monitoring-loop`](../../examples/monitoring-loop), [`examples/recovery`](../../examples/recovery), [`examples/facts-recovery`](../../examples/facts-recovery), and [`examples/independent-verification`](../../examples/independent-verification).
