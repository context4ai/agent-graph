import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentGraphError } from "./errors.js";
import { digestText, resolveContainedPath, writeJsonAtomic, writeTextAtomic } from "./io.js";
import { locateResource } from "./router.js";
import type { ActionDefinition, DynamicResourceDefinition, JsonValue, LoadedProvider, ResourceLocation } from "./types.js";

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
  workspace: string,
  revision: string,
  input: JsonValue | undefined,
): Promise<string> {
  const plan = materializerCommand(provider, action);
  const cwd = action.cwd === "provider" ? provider.root : resolve(workspace);
  return new Promise((accept, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd,
      env: {
        ...process.env,
        AGENT_GRAPH_PROVIDER_ROOT: provider.root,
        AGENT_GRAPH_WORKSPACE: resolve(workspace),
        AGENT_GRAPH_REVISION: revision,
        AGENT_GRAPH_INPUT: JSON.stringify(input ?? null),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) accept(stdout);
      else reject(new AgentGraphError("materializer-failed", `Materializer ${action.id} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

export async function materializeResource(
  provider: LoadedProvider,
  referenceOrId: string,
  options: { cache: string; workspace: string; revision: string; input?: JsonValue },
): Promise<ResourceLocation> {
  if (!/^sha256:[a-f0-9]{64}$/.test(options.revision)) {
    throw new AgentGraphError("revision-invalid", `Dynamic resource revision is invalid: ${options.revision}`);
  }
  const location = await locateResource(provider, referenceOrId);
  const resourcePath = location.materialize?.resourcePath ?? location.filePath;
  const resource = resourcePath ? provider.resources.get(resourcePath) : undefined;
  if (!resource) throw new AgentGraphError("resource-missing", `Provider ${provider.manifest.id} has no resource ${referenceOrId}`);
  if (!resource.dynamic) throw new AgentGraphError("resource-static", `Resource ${resource.metadata.id} is static and does not need materialization`);
  const definition = resource.metadata as DynamicResourceDefinition;
  const actionPath = resolveContainedPath(provider.root, definition.materializer, "materializer action reference");
  const action = provider.actions.get(actionPath)?.definition;
  if (!action) throw new AgentGraphError("materializer-missing", `Resource ${definition.id} references missing materializer`);
  if (action.effect !== "read") throw new AgentGraphError("materializer-effect-invalid", `Materializer ${action.id} must be read-only`);

  const content = await capture(provider, action, options.workspace, options.revision, options.input);
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
