import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import YAML from "yaml";
import { AgentGraphError } from "./errors.js";
import type { JsonValue, StaticResourceMetadata } from "./types.js";

export async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new AgentGraphError("file-read-failed", `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readStructuredFile<T>(path: string): Promise<T> {
  const content = await readText(path);
  try {
    return (extname(path).toLowerCase() === ".json" ? JSON.parse(content) : YAML.parse(content)) as T;
  } catch (error) {
    throw new AgentGraphError("parse-failed", `Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function writeTextAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

export function stableStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function digestText(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function digestValue(value: unknown): string {
  return digestText(stableStringify(value));
}

export async function digestFile(path: string): Promise<string> {
  const content = await readFile(path);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function listFilesRecursive(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  await visit(resolve(root));
  return result;
}

export function resolveContainedPath(base: string, reference: string, label = "path"): string {
  if (isAbsolute(reference)) {
    throw new AgentGraphError("absolute-path-forbidden", `${label} must be relative: ${reference}`);
  }
  const resolvedBase = resolve(base);
  const resolved = resolve(resolvedBase, reference);
  const rel = relative(resolvedBase, resolved);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new AgentGraphError("path-outside-provider", `${label} escapes the provider root: ${reference}`);
  }
  return resolved;
}

export function relativePortable(base: string, path: string): string {
  return relative(base, path).split("\\").join("/");
}

export async function ensureFile(path: string, label = "file"): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new AgentGraphError("file-missing", `${label} does not exist: ${path}`);
}

export async function ensureContainedFile(base: string, path: string, label = "file"): Promise<void> {
  await ensureFile(path, label);
  const [resolvedBase, resolvedFile] = await Promise.all([realpath(base), realpath(path)]);
  const rel = relative(resolvedBase, resolvedFile);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new AgentGraphError("path-symlink-outside-provider", `${label} resolves outside the provider root: ${path}`);
  }
}

export interface FrontmatterDocument {
  metadata: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string, path: string): FrontmatterDocument {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    throw new AgentGraphError("frontmatter-missing", `Markdown resource requires YAML frontmatter: ${path}`);
  }
  const normalized = content.replaceAll("\r\n", "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) throw new AgentGraphError("frontmatter-invalid", `Markdown frontmatter is not closed: ${path}`);
  const header = normalized.slice(4, end);
  const parsed = YAML.parse(header) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentGraphError("frontmatter-invalid", `Markdown frontmatter must be an object: ${path}`);
  }
  return { metadata: parsed as Record<string, unknown>, body: normalized.slice(end + 5) };
}

export async function readStaticResourceMetadata(path: string): Promise<StaticResourceMetadata> {
  const content = await readText(path);
  const { metadata } = parseFrontmatter(content, path);
  const id = metadata.id;
  const kind = metadata.kind;
  const mediaType = metadata["media-type"] ?? metadata.mediaType ?? "text/markdown";
  if (typeof id !== "string" || typeof kind !== "string" || typeof mediaType !== "string") {
    throw new AgentGraphError("resource-metadata-invalid", `Resource ${path} must declare string id, kind, and media-type`);
  }
  const allowed = new Set(["procedure", "diagnostic", "template", "schema", "skill"]);
  if (!allowed.has(kind)) {
    throw new AgentGraphError("resource-kind-invalid", `Static resource ${path} has unsupported kind: ${kind}`);
  }
  return { id, kind: kind as StaticResourceMetadata["kind"], mediaType };
}

export function getFact(facts: Record<string, JsonValue>, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = facts;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (current === null || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}
