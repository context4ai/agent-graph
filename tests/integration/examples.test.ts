import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadProvider, runGraphTests } from "../../src/index.js";

const examples = [
  "choice-routing",
  "dynamic-context",
  "dynamic-resource",
  "fact-driven-batch",
  "facts-recovery",
  "getting-started",
  "independent-verification",
  "monitoring-loop",
  "recovery",
  "review-gate",
  "shared-provider",
  "simple-skill",
  "subgraphs",
];

describe("published examples", () => {
  for (const name of examples) {
    test(`${name} validates and its graph cases pass`, async () => {
      const root = resolve(import.meta.dir, "../../examples", name);
      const provider = await loadProvider(resolve(root, "provider.yaml"));
      expect(provider.manifest.compatibility?.agentGraph).toBe("^0.2.0");
      const results = await runGraphTests(provider, resolve(root, "tests"));
      expect(results.length).toBeGreaterThan(0);
      expect(results.filter((result) => !result.passed)).toEqual([]);
    });
  }

  test("provider registry resolves two independent Skills to one provider", async () => {
    const { readProviderRegistry, resolveSkillBinding } = await import("../../src/index.js");
    const root = resolve(import.meta.dir, "../../examples/provider-registry");
    const registry = await readProviderRegistry(resolve(root, "registry.yaml"));
    const first = await resolveSkillBinding(resolve(root, "consumer-a/SKILL.md"), { registry });
    const second = await resolveSkillBinding(resolve(root, "consumer-b/SKILL.md"), { registry });
    expect(first.manifestPath).toBe(second.manifestPath);
    expect(first.graph).toBe("main");
    expect(first.entry).toBe("default");
    const provider = await loadProvider(first.manifestPath);
    expect(provider.manifest.compatibility?.agentGraph).toBe("^0.2.0");
  });
});
