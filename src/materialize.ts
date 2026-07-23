import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentGraphError } from "./errors.js";
import { digestText, resolveContainedPath, writeJsonAtomic, writeTextAtomic } from "./io.js";
import { locateResource } from "./router.js";
import type { ActionDefinition, DynamicResourceDefinition, JsonValue, LoadedProvider, ResourceLocation } from "./types.js";

export const DEFAULT_MATERIALIZER_TIMEOUT_MS = 30_000;
export const DEFAULT_MATERIALIZER_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MATERIALIZER_MAX_ERROR_BYTES = 1024 * 1024;

export interface MaterializeResourceOptions {
  cache: string;
  workspace: string;
  revision: string;
  input?: JsonValue;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxErrorBytes?: number;
  env?: Record<string, string>;
}

interface CaptureOptions {
  workspace: string;
  revision: string;
  input: JsonValue | undefined;
  timeoutMs: number;
  maxOutputBytes: number;
  maxErrorBytes: number;
  env: Record<string, string> | undefined;
}

const INHERITED_ENVIRONMENT_KEYS = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
] as const;

function extensionFor(mediaType: string): string {
  if (mediaType.includes("json")) return ".json";
  if (mediaType.includes("markdown")) return ".md";
  if (mediaType.startsWith("text/")) return ".txt";
  return ".bin";
}

function materializerCommand(provider: LoadedProvider, action: ActionDefinition): { command: string; args: string[] } {
  if (action.runner === "command") return { command: "sh", args: ["-c", action.command!] };
  if (action.runner !== "script") {
    throw new AgentGraphError("materializer-runner-invalid", `Materializer ${action.id} must use command or script runner`);
  }
  const runtimes = { node: "node", bun: "bun", python: "python3", shell: "sh" } as const;
  return {
    command: runtimes[action.runtime!],
    args: [resolveContainedPath(provider.root, action.entry!, "materializer entry"), ...(action.args ?? [])],
  };
}

async function capture(
  provider: LoadedProvider,
  action: ActionDefinition,
  options: CaptureOptions,
): Promise<string> {
  const plan = materializerCommand(provider, action);
  const workspace = resolve(options.workspace);
  const cwd = action.cwd === "provider" ? provider.root : workspace;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  Object.assign(environment, options.env);
  Object.assign(environment, {
    AGENT_GRAPH_PROVIDER_ROOT: provider.root,
    AGENT_GRAPH_WORKSPACE: workspace,
    AGENT_GRAPH_REVISION: options.revision,
    AGENT_GRAPH_INPUT: JSON.stringify(options.input ?? null),
  });
  return new Promise((accept, reject) => {
    const detached = process.platform !== "win32";
    const child = spawn(plan.command, plan.args, {
      cwd,
      detached,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let terminated = false;
    const terminate = (): void => {
      if (child.exitCode !== null || child.killed || terminated) return;
      terminated = true;
      if (detached && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Fall back to the direct child when the process group no longer exists.
        }
      }
      child.kill("SIGKILL");
    };
    const fail = (error: AgentGraphError | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminate();
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new AgentGraphError(
        "materializer-timeout",
        `Materializer ${action.id} exceeded the ${options.timeoutMs}ms timeout`,
      ));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxOutputBytes) {
        fail(new AgentGraphError(
          "materializer-output-limit",
          `Materializer ${action.id} exceeded the ${options.maxOutputBytes} byte stdout limit`,
        ));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > options.maxErrorBytes) {
        fail(new AgentGraphError(
          "materializer-error-limit",
          `Materializer ${action.id} exceeded the ${options.maxErrorBytes} byte stderr limit`,
        ));
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) accept(Buffer.concat(stdout).toString("utf8"));
      else reject(new AgentGraphError(
        "materializer-failed",
        `Materializer ${action.id} exited with ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
      ));
    });
  });
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AgentGraphError("materializer-option-invalid", `${label} must be a positive integer: ${value}`);
  }
  return value;
}

export async function materializeResource(
  provider: LoadedProvider,
  referenceOrId: string,
  options: MaterializeResourceOptions,
): Promise<ResourceLocation> {
  if (!/^sha256:[a-f0-9]{64}$/.test(options.revision)) {
    throw new AgentGraphError("revision-invalid", `Dynamic resource revision is invalid: ${options.revision}`);
  }
  const location = await locateResource(provider, referenceOrId);
  const resource = [...provider.resources.values()].find(
    (candidate) => candidate.metadata.id === location.id,
  );
  if (!resource) throw new AgentGraphError("resource-missing", `Provider ${provider.manifest.id} has no resource ${referenceOrId}`);
  if (!resource.dynamic) throw new AgentGraphError("resource-static", `Resource ${resource.metadata.id} is static and does not need materialization`);
  const definition = resource.metadata as DynamicResourceDefinition;
  const actionPath = resolveContainedPath(provider.root, definition.materializer, "materializer action reference");
  const action = provider.actions.get(actionPath)?.definition;
  if (!action) throw new AgentGraphError("materializer-missing", `Resource ${definition.id} references missing materializer`);
  if (action.effect !== "read") throw new AgentGraphError("materializer-effect-invalid", `Materializer ${action.id} must be read-only`);

  const content = await capture(provider, action, {
    workspace: options.workspace,
    revision: options.revision,
    input: options.input,
    timeoutMs: positiveInteger(options.timeoutMs ?? DEFAULT_MATERIALIZER_TIMEOUT_MS, "timeoutMs"),
    maxOutputBytes: positiveInteger(options.maxOutputBytes ?? DEFAULT_MATERIALIZER_MAX_OUTPUT_BYTES, "maxOutputBytes"),
    maxErrorBytes: positiveInteger(options.maxErrorBytes ?? DEFAULT_MATERIALIZER_MAX_ERROR_BYTES, "maxErrorBytes"),
    env: options.env,
  });
  const digest = digestText(content);
  const cache = resolve(options.cache);
  await mkdir(cache, { recursive: true });
  const token = digest.slice("sha256:".length);
  const filePath = resolve(cache, `${token}${extensionFor(definition.mediaType)}`);
  await writeTextAtomic(filePath, content);
  await writeJsonAtomic(resolve(cache, `${token}.receipt.json`), {
    schema: "agent-graph.materialization.v1",
    provider: provider.manifest.id,
    resource: definition.id,
    revision: options.revision,
    digest,
    mediaType: definition.mediaType,
    file: filePath,
  });
  return {
    schema: "agent-graph.resource-location.v1",
    id: definition.id,
    kind: "context-view",
    mediaType: definition.mediaType,
    revision: options.revision,
    digest,
    filePath,
  };
}
