import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentGraphError } from "./errors.js";
import { readStructuredFile, writeJsonAtomic } from "./io.js";
import { validateSchema } from "./schema.js";
import type { JsonValue, Outcome, RunEvent, RunState } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function nextEvent(state: RunState, type: string, detail?: JsonValue): RunEvent {
  return {
    sequence: (state.events.at(-1)?.sequence ?? 0) + 1,
    at: now(),
    type,
    ...(detail === undefined ? {} : { detail }),
  };
}

async function persist(path: string, state: RunState): Promise<RunState> {
  state.updatedAt = now();
  await validateSchema("run", state, path);
  await writeJsonAtomic(resolve(path), state);
  return state;
}

async function ensureRunTargetAbsent(path: string, label: string): Promise<void> {
  if (await stat(resolve(path)).catch(() => null)) {
    throw new AgentGraphError("run-target-exists", `${label} refuses to replace an existing path: ${resolve(path)}`);
  }
}

export async function createRun(
  path: string,
  input: {
    id?: string;
    provider: string;
    graph: string;
    entry?: string;
    workspace?: string;
    facts?: Record<string, JsonValue>;
    authorities?: string[];
  },
): Promise<RunState> {
  await ensureRunTargetAbsent(path, "Run start");
  const at = now();
  const state: RunState = {
    schema: "agent-graph.run.v1",
    id: input.id ?? randomUUID(),
    provider: input.provider,
    graph: input.graph,
    entry: input.entry ?? "default",
    ...(input.workspace ? { workspace: resolve(input.workspace) } : {}),
    createdAt: at,
    updatedAt: at,
    facts: input.facts ?? {},
    outcomes: {},
    authorities: [...new Set(input.authorities ?? [])].sort(),
    events: [{ sequence: 1, at, type: "run.started" }],
  };
  await validateSchema("run", state, path);
  await writeJsonAtomic(resolve(path), state);
  return state;
}

export async function loadRun(path: string): Promise<RunState> {
  const absolute = resolve(path);
  const state = await readStructuredFile<RunState>(absolute);
  await validateSchema("run", state, absolute);
  return state;
}

export async function recordOutcome(
  path: string,
  node: string,
  outcome: Outcome,
  detail?: JsonValue,
): Promise<RunState> {
  const state = await loadRun(path);
  const at = now();
  state.outcomes[node] = { outcome, recordedAt: at, ...(detail === undefined ? {} : { detail }) };
  state.events.push({
    sequence: (state.events.at(-1)?.sequence ?? 0) + 1,
    at,
    type: "node.outcome-recorded",
    node,
    outcome,
    ...(detail === undefined ? {} : { detail }),
  });
  return persist(path, state);
}

export async function updateRunFacts(
  path: string,
  facts: Record<string, JsonValue>,
  replace = false,
): Promise<RunState> {
  const state = await loadRun(path);
  state.facts = replace ? facts : { ...state.facts, ...facts };
  state.events.push(nextEvent(state, replace ? "facts.replaced" : "facts.updated", { keys: Object.keys(facts).sort() }));
  return persist(path, state);
}

export async function updateRunAuthorities(path: string, authorities: string[]): Promise<RunState> {
  const state = await loadRun(path);
  state.authorities = [...new Set(authorities)].sort();
  state.events.push(nextEvent(state, "authorities.updated", { authorities: state.authorities }));
  return persist(path, state);
}

export async function checkpointRun(path: string, checkpointPath: string): Promise<{ run: string; checkpoint: string }> {
  const run = resolve(path);
  const checkpoint = resolve(checkpointPath);
  await ensureRunTargetAbsent(checkpoint, "Checkpoint");
  await loadRun(run);
  const state = await loadRun(run);
  state.events.push(nextEvent(state, "run.checkpointed", { checkpoint: basename(checkpoint) }));
  await persist(run, state);
  const snapshot = structuredClone(state);
  snapshot.authorities = [];
  await validateSchema("run", snapshot, checkpoint);
  await mkdir(dirname(checkpoint), { recursive: true });
  await writeJsonAtomic(checkpoint, snapshot);
  return { run, checkpoint };
}

export async function resumeRun(checkpointPath: string, path: string): Promise<RunState> {
  await ensureRunTargetAbsent(path, "Run resume");
  const checkpoint = await loadRun(checkpointPath);
  const state: RunState = structuredClone(checkpoint);
  state.authorities = [];
  state.events.push(nextEvent(state, "run.resumed", { checkpoint: basename(checkpointPath) }));
  return persist(path, state);
}

export function runEvaluationInput(state: RunState) {
  return {
    facts: state.facts,
    outcomes: state.outcomes,
    authorities: state.authorities,
    runPath: state.id,
    ...(state.workspace ? { workspace: state.workspace } : {}),
  };
}

export function assertRunTargetsProvider(state: RunState, provider: string): void {
  if (state.provider !== provider) {
    throw new AgentGraphError("run-provider-mismatch", `Run ${state.id} targets ${state.provider}, not ${provider}`);
  }
}
