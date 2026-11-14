import { describe, expect, test } from "bun:test";
import { MAX_SPOKEN_CHARS, isVoiceId, spokenText, voiceIdFor } from "../convex/lib/voices";

describe("voiceIdFor", () => {
  test("uses the chosen voice", () => {
    expect(voiceIdFor({ voiceId: "nPczCjzI2devNBz1zQrb", gender: "female" })).toBe("nPczCjzI2devNBz1zQrb");
  });

  test("falls back by gender when no voice or an unknown one is set", () => {
    expect(voiceIdFor({ gender: "male" })).toBe("JBFqnCBsd6RMkjVDRZzb");
    expect(voiceIdFor({ voiceId: "gone", gender: "female" })).toBe("21m00Tcm4TlvDq8ikWAM");
    expect(voiceIdFor({})).toBe("21m00Tcm4TlvDq8ikWAM");
  });

  test("every default is in the list", () => {
    expect(isVoiceId(voiceIdFor({ gender: "male" }))).toBe(true);
    expect(isVoiceId(voiceIdFor({ gender: "female" }))).toBe(true);
  });
});

describe("spokenText", () => {
  test("strips formatting that would be read out", () => {
    expect(spokenText("*Price:* ₹4,999 _per month_")).toBe("Price: ₹4,999 per month");
    expect(spokenText("- one\n- two")).toBe("one two");
  });

  test("reads link labels, not URLs", () => {
    expect(spokenText("See [our pricing](https://x.com/p)")).toBe("See our pricing");
    expect(spokenText("Visit https://magicwebs.ai/pricing today")).toBe("Visit the link today");
  });

  test("caps the length", () => {
    expect(spokenText("a ".repeat(2000)).length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
  });
});
