import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import YAML from "yaml";
import { AgentGraphError } from "./errors.js";
import { digestFile, digestValue, relativePortable, writeJsonAtomic, writeTextAtomic } from "./io.js";
import { validateSchema } from "./schema.js";
import type { BundleManifest, BundleManifestEntry, LoadedProvider } from "./types.js";

function entry(id: string, path: string, digest: string): BundleManifestEntry {
  return { id, path, digest };
}

function containsPath(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

export async function buildProviderBundle(provider: LoadedProvider, output: string): Promise<BundleManifest> {
  const destination = resolve(output);
  if (destination === provider.root || [...provider.files].some((file) => containsPath(destination, file))) {
    throw new AgentGraphError("build-output-overlaps-source", "Build output must not replace the provider root or any referenced source file");
  }
  const working = `${destination}.tmp`;
  await rm(working, { recursive: true, force: true });
  await mkdir(working, { recursive: true });

  const sourceFiles = [...provider.files]
    .filter((path) => path !== provider.manifestPath)
    .sort((left, right) => relativePortable(provider.root, left).localeCompare(relativePortable(provider.root, right)));
  const sourceRootBytes = Buffer.from(provider.root);
  for (const source of sourceFiles) {
    if ((await readFile(source)).includes(sourceRootBytes)) {
      throw new AgentGraphError(
        "build-absolute-path-leak",
        `Referenced file contains the source Provider absolute path: ${relativePortable(provider.root, source)}`,
      );
    }
  }
  for (const source of sourceFiles) {
    const relativePath = relativePortable(provider.root, source);
    const target = resolve(working, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  const providerManifest = "provider.yaml";
  await writeTextAtomic(resolve(working, providerManifest), YAML.stringify(provider.manifest, { lineWidth: 0 }));

  const digestAt = async (absolute: string): Promise<string> => digestFile(resolve(working, relativePortable(provider.root, absolute)));
  const graphs = await Promise.all([...provider.graphs.values()]
    .sort((a, b) => a.definition.id.localeCompare(b.definition.id))
    .map(async (graph) => entry(graph.definition.id, relativePortable(provider.root, graph.path), await digestAt(graph.path))));
  const actions = await Promise.all([...provider.actions.values()]
    .sort((a, b) => a.definition.id.localeCompare(b.definition.id))
    .map(async (action) => entry(action.definition.id, relativePortable(provider.root, action.path), await digestAt(action.path))));
  const resources = await Promise.all([...provider.resources.values()]
    .sort((a, b) => a.metadata.id.localeCompare(b.metadata.id))
    .map(async (resource) => entry(resource.metadata.id, relativePortable(provider.root, resource.path), await digestAt(resource.path))));

  const schemaPaths = new Map<string, string>();
  for (const action of provider.actions.values()) {
    for (const path of [action.definition.inputSchema, action.definition.outputSchema]) if (path) schemaPaths.set(path, path);
  }
  for (const resource of provider.resources.values()) {
    if (!resource.dynamic && resource.metadata.kind === "schema") {
      schemaPaths.set(relativePortable(provider.root, resource.contentPath), resource.metadata.id);
    }
  }
  const schemas = await Promise.all([...schemaPaths.entries()].sort(([left], [right]) => left.localeCompare(right)).map(async ([path, id]) => {
    const absolute = resolve(provider.root, path);
    return entry(id, path, await digestAt(absolute));
  }));

  const copiedFiles = [providerManifest, ...sourceFiles.map((path) => relativePortable(provider.root, path))].sort();
  const files = await Promise.all(copiedFiles.map(async (path) => ({ path, digest: await digestFile(resolve(working, path)) })));
  const graphDependencies = Object.fromEntries([...provider.graphDependencies.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, dependencies]) => [id, [...dependencies].sort()]));
  const unsigned = {
    schema: "agent-graph.bundle.v1" as const,
    provider: { id: provider.manifest.id, version: provider.manifest.version },
    providerManifest,
    graphs,
    actions,
    resources,
    schemas,
    files,
    graphDependencies,
  };
  const manifest: BundleManifest = { ...unsigned, digest: digestValue(unsigned) };
  await validateSchema("bundle", manifest, resolve(working, "manifest.json"));
  await writeJsonAtomic(resolve(working, "manifest.json"), manifest);

  const serialized = JSON.stringify(manifest);
  if (serialized.includes(provider.root)) {
    throw new AgentGraphError("build-absolute-path-leak", "Generated bundle contains the source provider absolute path");
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await rename(working, destination);
  return manifest;
}
