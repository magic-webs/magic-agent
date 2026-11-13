import { describe, expect, test } from "bun:test";
import { carriedChunkIds, mergePassages } from "../convex/lib/knowledgeCarry";

describe("carriedChunkIds", () => {
  test("takes chunks from the last three AI replies, newest first", () => {
    const ids = carriedChunkIds([
      { role: "user" },
      { role: "assistant", knowledgeChunkIds: ["a", "b"] },
      { role: "assistant", sentByHuman: true, knowledgeChunkIds: ["x"] },
      { role: "user" },
      { role: "assistant", knowledgeChunkIds: ["b", "c"] },
      { role: "assistant" },
      { role: "assistant", knowledgeChunkIds: ["old"] },
    ]);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  test("is empty for a new conversation", () => {
    expect(carriedChunkIds([])).toEqual([]);
  });
});

describe("mergePassages", () => {
  const p = (chunkId: string) => ({ chunkId });

  test("keeps fresh hits first and drops duplicates", () => {
    const out = mergePassages([p("a"), p("b")], [p("b"), p("c")], 10);
    expect(out.map((x) => x.chunkId)).toEqual(["a", "b", "c"]);
  });

  test("caps the total", () => {
    const out = mergePassages([p("a"), p("b")], [p("c"), p("d")], 3);
    expect(out.map((x) => x.chunkId)).toEqual(["a", "b", "c"]);
  });

  test("still carries passages when the new search finds nothing", () => {
    const out = mergePassages([], [p("kemet")], 8);
    expect(out.map((x) => x.chunkId)).toEqual(["kemet"]);
  });
});
