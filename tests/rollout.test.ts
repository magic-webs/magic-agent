import { describe, expect, test } from "bun:test";
import {
  dailyLimit,
  decide,
  nextCheckAt,
  normaliseQuality,
  normaliseTier,
  planWaves,
  scoreContact,
  usedSince,
  validPlan,
  waveTargets,
  type WaveMetrics,
} from "../convex/lib/rollout";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 22, 10);

const healthyWave: WaveMetrics = {
  sent: 190,
  failed: 10,
  delivered: 185,
  optedOut: 1,
  heldBack: 2,
  blocked: 0,
  unreachable: 3,
};

function base(overrides: Partial<Parameters<typeof decide>[0]> = {}): Parameters<typeof decide>[0] {
  return {
    now: NOW,
    quality: "GREEN",
    limit: 2_000,
    hours: [],
    templateBlocker: null,
    previous: healthyWave,
    waveEndedAt: NOW - 20 * HOUR,
    queued: 1_800,
    target: 400,
    lastSize: 200,
    holds: 0,
    heldForWave: false,
    ...overrides,
  };
}

describe("limits and quality", () => {
  test("tiers parse to daily limits", () => {
    expect(dailyLimit("TIER_250")).toBe(250);
    expect(dailyLimit("TIER_2K")).toBe(2_000);
    expect(dailyLimit("TIER_100K")).toBe(100_000);
    expect(dailyLimit("TIER_UNLIMITED")).toBe(Number.POSITIVE_INFINITY);
    expect(dailyLimit(undefined)).toBeNull();
    expect(normaliseTier("TIER_1K")).toBe("TIER_1K");
    expect(normaliseTier(2000)).toBe("TIER_2K");
    expect(normaliseTier("unlimited")).toBe("TIER_UNLIMITED");
    expect(normaliseTier("nonsense")).toBeUndefined();
  });

  test("quality words map to colours", () => {
    expect(normaliseQuality("GREEN")).toBe("GREEN");
    expect(normaliseQuality("MEDIUM")).toBe("YELLOW");
    expect(normaliseQuality("low")).toBe("RED");
    expect(normaliseQuality("NA")).toBe("UNKNOWN");
  });
});

describe("plan", () => {
  test("valid plans", () => {
    expect(validPlan({ shares: [10, 20, 30, 40], gapDays: 1 })).toBeNull();
    expect(validPlan({ shares: [10, 20, 30], gapDays: 1 })).toBeNull();
    expect(validPlan({ shares: [10, 120], gapDays: 1 })).not.toBeNull();
    expect(validPlan({ shares: [], gapDays: 1 })).not.toBeNull();
    expect(validPlan({ shares: [50, 50], gapDays: 0 })).not.toBeNull();
  });

  test("targets are shares of the daily limit, repeating the last", () => {
    expect(waveTargets(2_000, [10, 20, 30, 40], 2_000)).toEqual([200, 400, 600, 800]);
    expect(waveTargets(2_000, [10, 20, 30, 40], 10_000)).toEqual([1_000, 1_000]);
    expect(waveTargets(2_000, [10, 20, 30, 40], null)).toEqual([100, 200, 300, 400, 400, 400, 200]);
    expect(waveTargets(300, [10, 20, 30, 40], null)).toEqual([100, 200]);
    expect(waveTargets(40, [10, 20, 30, 40], null)).toEqual([40]);
    expect(waveTargets(0, [100], null)).toEqual([]);
  });

  test("an unlimited number splits the audience by share", () => {
    expect(waveTargets(2_000, [10, 20, 30, 40], Infinity)).toEqual([200, 400, 600, 800]);
    expect(waveTargets(300, [10, 20, 30, 40], Infinity)).toEqual([90, 90, 120]);
  });

  test("waves follow the gap and stay under the safe limit", () => {
    const { waves, days } = planWaves({
      reachable: 2_000,
      shares: [10, 20, 30, 40],
      gapDays: 2,
      limit: 2_000,
      used24h: 0,
      startDate: "2026-10-22",
    });
    expect(waves.map((w) => [w.date, w.size])).toEqual([
      ["2026-10-22", 200],
      ["2026-10-24", 400],
      ["2026-10-26", 600],
      ["2026-10-28", 800],
    ]);
    expect(days).toBe(7);
  });

  test("a low limit adds extra days", () => {
    const { waves, safeDaily } = planWaves({
      reachable: 1_000,
      shares: [100],
      gapDays: 1,
      limit: 250,
      used24h: 0,
      startDate: "2026-10-22",
    });
    expect(safeDaily).toBe(200);
    expect(waves.every((w) => w.size <= 200)).toBe(true);
    expect(waves.reduce((sum, w) => sum + w.size, 0)).toBe(1_000);
    expect(waves[1].continued).toBe(true);
  });
});

describe("decide", () => {
  test("launches the target when healthy", () => {
    const decision = decide(base());
    expect(decision).toMatchObject({ kind: "launch", size: 400 });
  });

  test("finishes when nobody is left", () => {
    expect(decide(base({ queued: 0 })).kind).toBe("finish");
  });

  test("pauses on red quality, template problems and spam", () => {
    expect(decide(base({ quality: "RED" })).kind).toBe("pause");
    expect(decide(base({ templateBlocker: "paused" })).kind).toBe("pause");
    expect(decide(base({ templateQuality: "RED" })).kind).toBe("pause");
    expect(decide(base({ previous: { ...healthyWave, blocked: 1 } })).kind).toBe("pause");
  });

  test("pauses on high opt-outs or failures", () => {
    expect(decide(base({ previous: { ...healthyWave, optedOut: 6 } })).kind).toBe("pause");
    expect(decide(base({ previous: { ...healthyWave, sent: 150, failed: 50 } })).kind).toBe("pause");
  });

  test("ignores numbers not on WhatsApp in the failure rate", () => {
    const decision = decide(base({ previous: { ...healthyWave, sent: 150, failed: 50, unreachable: 45 } }));
    expect(decision.kind).toBe("launch");
  });

  test("holds on yellow and halves the next wave", () => {
    const decision = decide(base({ quality: "YELLOW" }));
    expect(decision).toMatchObject({ kind: "hold", shrink: 0.5 });
    if (decision.kind === "hold") expect(decision.until).toBe(NOW + 48 * HOUR);
  });

  test("a soft signal holds once, then sends a smaller wave", () => {
    const warned = { ...healthyWave, optedOut: 4 };
    expect(decide(base({ previous: warned })).kind).toBe("hold");
    expect(decide(base({ previous: warned, heldForWave: true, shrink: 0.5 }))).toMatchObject({
      kind: "launch",
      size: 100,
    });
  });

  test("three holds in a row pause", () => {
    expect(decide(base({ quality: "YELLOW", holds: 3 })).kind).toBe("pause");
  });

  test("waits for delivery reports to settle", () => {
    const unsettled = { ...healthyWave, delivered: 20 };
    expect(decide(base({ previous: unsettled, waveEndedAt: NOW - HOUR })).kind).toBe("wait");
    expect(decide(base({ previous: unsettled, waveEndedAt: NOW - 13 * HOUR })).kind).toBe("launch");
  });

  test("cuts a wave to the safe daily limit", () => {
    const hours = [{ hour: Math.floor(NOW / HOUR) - 2, sent: 1_400 }];
    expect(decide(base({ hours }))).toMatchObject({ kind: "launch", size: 200 });
  });

  test("waits until the rolling window frees up", () => {
    const hour = Math.floor(NOW / HOUR) - 5;
    const decision = decide(base({ limit: 250, hours: [{ hour, sent: 200 }] }));
    expect(decision.kind).toBe("wait");
    if (decision.kind === "wait") expect(decision.until).toBe((hour + 24) * HOUR + 10 * 60 * 1000);
  });

  test("assumes a cautious limit when Meta cannot be read", () => {
    expect(decide(base({ limit: null, quality: "UNKNOWN", target: 5_000, queued: 5_000 }))).toMatchObject({
      kind: "launch",
      size: 800,
    });
  });
});

describe("helpers", () => {
  test("engagement score", () => {
    expect(scoreContact({ lastRepliedAt: NOW - 2 * DAY }, NOW)).toBe(3);
    expect(scoreContact({ lastReadAt: NOW - 10 * DAY }, NOW)).toBe(2);
    expect(scoreContact({ lastReadAt: NOW - 400 * DAY }, NOW)).toBe(1);
    expect(scoreContact({}, NOW)).toBe(0);
  });

  test("rolling 24h usage ignores older hours", () => {
    const hour = Math.floor(NOW / HOUR);
    expect(usedSince([{ hour, sent: 5 }, { hour: hour - 23, sent: 7 }, { hour: hour - 24, sent: 100 }], NOW)).toBe(12);
  });

  test("next check is the send hour after the gap, at least 8 hours on", () => {
    const start = Date.UTC(2026, 9, 22, 10);
    expect(
      nextCheckAt({ waveStartedAt: start, waveEndedAt: start + HOUR, sendHour: 10, gapDays: 1, timeZone: "UTC" })
    ).toBe(start + DAY);
    expect(
      nextCheckAt({ waveStartedAt: start, waveEndedAt: start + 20 * HOUR, sendHour: 10, gapDays: 1, timeZone: "UTC" })
    ).toBe(start + 2 * DAY);
  });
});
