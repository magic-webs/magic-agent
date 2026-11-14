import { describe, expect, test } from "bun:test";
import { carriedChunkIds, citedFirst, mergePassages, recentReplyTexts } from "../convex/lib/knowledgeCarry";

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

describe("citedFirst", () => {
  const caseStudy = {
    chunkId: "case",
    text: "# Case study: Fisherman's Cove Resort — SEO and website development. Client: a beach resort in Seychelles. Results: +94.81% site visits (about 95%).",
  };
  const pricing = {
    chunkId: "pricing",
    text: "Our SEO packages start at 15,000 per month and include keyword research.",
  };
  const team = { chunkId: "team", text: "The design team works from Kolkata, Monday to Saturday." };

  test("keeps the passage a reply just quoted ahead of the rest", () => {
    const { cited, rest } = citedFirst([pricing, team, caseStudy], [
      "Makes sense. We did SEO and web development for Fisherman's Cove Resort, and their site visits went up about 95 percent.",
    ]);
    expect(cited.map((p) => p.chunkId)).toEqual(["case"]);
    expect(rest.map((p) => p.chunkId)).toEqual(["pricing", "team"]);
  });

  test("matches a rounded figure to the exact one", () => {
    const rabat = {
      chunkId: "rabat",
      text: "Case study: Story Rabat, a luxury boutique hotel. Results: organic site traffic +411.61%; bounce rate 60% → 30%.",
    };
    const { cited } = citedFirst([pricing, rabat], [
      "We've grown one boutique hotel's organic traffic by over 400%, so it's a good place to start.",
    ]);
    expect(cited.map((p) => p.chunkId)).toEqual(["rabat"]);
  });

  test("cites nothing when the replies quote nothing", () => {
    const { cited } = citedFirst([pricing, team, caseStudy], ["Got it. What's the company called?"]);
    expect(cited).toEqual([]);
  });

  test("reads only the latest AI replies", () => {
    expect(
      recentReplyTexts([
        { role: "assistant", text: "c" },
        { role: "user", text: "x" },
        { role: "assistant", text: "b", sentByHuman: true },
        { role: "assistant", text: "a" },
      ])
    ).toEqual(["c", "a"]);
  });
});
