import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const caseStudyRoot = resolve(process.cwd(), "case-studies/context");

async function collectTextFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectTextFiles(path);
    return [path];
  }));
  return files.flat();
}

describe("Context case study replay", () => {
  test("keeps the sanitized recording complete and ordered", async () => {
    const raw = await readFile(resolve(caseStudyRoot, "data/context-run.json"), "utf8");
    const replay = JSON.parse(raw) as {
      schema: string;
      source: { kind: string; recordedSteps: number };
      steps: Array<{ elapsed: number; node: string; status: string; reasonCode: string }>;
    };

    expect(replay.schema).toBe("agent-graph.case-study.replay.v1");
    expect(replay.source.kind).toBe("sanitized-recording");
    expect(replay.steps).toHaveLength(replay.source.recordedSteps);
    expect(replay.steps[0]?.node).toBe("choose-source-boundary");
    expect(replay.steps.at(-1)).toMatchObject({ node: "complete", status: "complete" });
    expect(replay.steps.every((step, index) => index === 0 || step.elapsed >= replay.steps[index - 1]!.elapsed)).toBe(true);
    expect(replay.steps.every((step) => step.reasonCode.length > 0)).toBe(true);
  });

  test("does not publish private recording data", async () => {
    const files = await collectTextFiles(caseStudyRoot);
    const text = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    const forbidden = [
      /\/Users\//u,
      /bytedance/iu,
      /\bTUX\b/u,
      /\bLynx\b/iu,
      /lark:/iu,
      /wiki-[a-z0-9]{12,}/iu,
      /sha256:[a-f0-9]{32,}/iu,
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    ];
    for (const pattern of forbidden) expect(text).not.toMatch(pattern);
  });

  test("keeps the active transition and arrowhead on the accent state", async () => {
    const script = await readFile(resolve(caseStudyRoot, "replay.js"), "utf8");
    const styles = await readFile(resolve(caseStudyRoot, "styles.css"), "utf8");

    expect(script).toContain('index === currentInstance - 1 ? "edge current"');
    expect(script).toContain('["arrow-active", "arrow-active"]');
    expect(script).toContain('className.includes("current") ? "url(#arrow-active)"');
    expect(styles).toContain(".edge.current { stroke: var(--accent);");
    expect(styles).toContain(".arrow-active { fill: var(--accent); }");
    expect(styles).not.toContain("marker-end: url(#arrow)");
  });

  test("defaults to English and keeps documentation replay links language-specific", async () => {
    const script = await readFile(resolve(caseStudyRoot, "replay.js"), "utf8");
    const english = await readFile(resolve(process.cwd(), "docs/en/case-studies/context.md"), "utf8");
    const chinese = await readFile(resolve(process.cwd(), "docs/zh-CN/case-studies/context.md"), "utf8");

    expect(script).toContain('let language = requestedLanguage === "zh" ? "zh" : "en";');
    expect(script).not.toContain('sub.className = "event-sub"');
    expect(english).toContain("/case-studies/context/?lang=en");
    expect(chinese).toContain("/case-studies/context/?lang=zh");
  });
});
