import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const sdk = await Bun.build({
  entrypoints: [resolve(root, "src/index.ts")],
  outdir: dist,
  target: "node",
  format: "esm",
  naming: "index.js",
  sourcemap: "none",
});
if (!sdk.success) throw new AggregateError(sdk.logs, "SDK build failed");

const cli = await Bun.build({
  entrypoints: [resolve(root, "src/bin.ts")],
  outdir: resolve(dist, ".cli"),
  target: "node",
  format: "esm",
  naming: "cli.js",
  sourcemap: "none",
  banner: "#!/usr/bin/env node",
});
if (!cli.success) throw new AggregateError(cli.logs, "CLI build failed");
const bundled = await readFile(resolve(dist, ".cli/cli.js"), "utf8");
await writeFile(resolve(dist, "agent-graph.mjs"), bundled, { encoding: "utf8", mode: 0o755 });
await rm(resolve(dist, ".cli"), { recursive: true, force: true });

const declarations = Bun.spawnSync([
  process.execPath,
  "x",
  "tsc",
  "-p",
  resolve(root, "tsconfig.build.json"),
], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (declarations.exitCode !== 0) throw new Error("Type declaration build failed");
