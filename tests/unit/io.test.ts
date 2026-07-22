import { describe, expect, test } from "bun:test";
import { getFact } from "../../src/index.js";

describe("fact paths", () => {
  test("resolves numeric segments as array indexes", () => {
    const facts = {
      items: [
        { done: false },
        { done: true },
      ],
    };
    expect(getFact(facts, "items.0.done")).toBe(false);
    expect(getFact(facts, "items.1.done")).toBe(true);
    expect(getFact(facts, "items.2.done")).toBeUndefined();
    expect(getFact(facts, "items.first.done")).toBeUndefined();
  });
});
