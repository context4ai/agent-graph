import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  AgentGraphError,
  type BundleManifest,
  buildProviderBundle,
  digestValue,
  evaluateGraph,
  initProvider,
  loadProvider,
  locateCode,
  resolveRoute,
  writeJsonAtomic,
  writeTextAtomic,
} from "../../src/index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("deterministic provider builds", () => {
  test("copies only reachable content and emits relocatable metadata", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-build-"));
    directories.push(directory);
    const provider = await loadProvider(resolve(import.meta.dir, "../../examples/simple-skill/provider.yaml"));
    const first = await buildProviderBundle(provider, resolve(directory, "first"));
    const second = await buildProviderBundle(provider, resolve(directory, "second"));
    expect(first.digest).toBe(second.digest);
    expect(first.files).toEqual(second.files);
    const serialized = await readFile(resolve(directory, "first/manifest.json"), "utf8");
    expect(serialized).not.toContain(provider.root);
    expect(first.files.some((file) => file.path === "skills/draft/SKILL.md")).toBe(true);
    expect(first.schemas).toContainEqual(expect.objectContaining({ id: "schema.draft-output", path: "schemas/draft-output.schema.json" }));
    const bundledProvider = await loadProvider(resolve(directory, "first/manifest.json"));
    expect(evaluateGraph(bundledProvider, "main").evaluation.revision).toBe(evaluateGraph(provider, "main").evaluation.revision);
    const evaluation = evaluateGraph(bundledProvider, "main", "default").evaluation;
    const route = await resolveRoute(bundledProvider, "main", "default", evaluation.primaryRoute!.routeId);
    const outputSchema = route.resources.required.find((resource) => resource.id === "schema.draft-output");
    expect(outputSchema?.filePath).toBe(resolve(directory, "first/schemas/draft-output.schema.json"));
    expect(JSON.parse(await readFile(outputSchema!.filePath!, "utf8"))).toEqual(expect.objectContaining({ type: "object" }));

    const catalogSource = await loadProvider(resolve(import.meta.dir, "../../examples/shared-provider/provider.yaml"));
    await buildProviderBundle(catalogSource, resolve(directory, "catalog"));
    const catalogBundle = await loadProvider(resolve(directory, "catalog/manifest.json"));
    const catalogCode = await locateCode(catalogBundle, "route.release.inspect");
    expect(catalogCode.document?.filePath).toBe(resolve(directory, "catalog/resources/checklist.md"));

    const secondManifestPath = resolve(directory, "second/manifest.json");
    const inconsistent = JSON.parse(await readFile(secondManifestPath, "utf8")) as BundleManifest;
    inconsistent.resources = [];
    const unsigned = { ...inconsistent } as Partial<BundleManifest>;
    delete unsigned.digest;
    inconsistent.digest = digestValue(unsigned);
    await writeJsonAtomic(secondManifestPath, inconsistent);
    await expect(loadProvider(secondManifestPath)).rejects.toMatchObject({ code: "bundle-catalog-mismatch" });

    await writeFile(resolve(directory, "first/resources/drafting.md"), "tampered\n", "utf8");
    try {
      await loadProvider(resolve(directory, "first/manifest.json"));
      throw new Error("expected bundle verification to reject tampering");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentGraphError);
      expect((error as AgentGraphError).code).toBe("bundle-file-digest-mismatch");
    }
  });

  test("rejects a reachable file that leaks the source Provider path", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agent-graph-path-leak-"));
    directories.push(directory);
    await initProvider(directory, "path-leak");
    await writeTextAtomic(resolve(directory, "leak.txt"), `source=${directory}\n`);
    await writeTextAtomic(resolve(directory, "actions/work.yaml"), `schema: agent-graph.action.v1
id: work
runner: agent
effect: write
skill: skills/getting-started/SKILL.md
files: [leak.txt]
`);
    const provider = await loadProvider(resolve(directory, "provider.yaml"));
    await expect(buildProviderBundle(provider, resolve(directory, "output"))).rejects.toMatchObject({ code: "build-absolute-path-leak" });
  });
});
