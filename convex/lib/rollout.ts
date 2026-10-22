import { addDays, zonedParts, zonedToInstant } from "./marketing";

export type Quality = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export type RolloutPlan = {
  shares: number[];
  gapDays: number;
  engagedFirst: boolean;
  limitTier?: string;
};

export const RECOMMENDED_SHARES = [10, 20, 30, 40];
export const MAX_WAVES = 8;
export const MIN_WAVE = 50;
export const SAFETY = 0.8;
export const ASSUMED_LIMIT = 1000;
export const GAP_DAYS = [1, 2, 3];

const HOUR_MS = 60 * 60 * 1000;
const MIN_WATCH_MS = 8 * HOUR_MS;
const SETTLE_MS = 12 * HOUR_MS;
const YELLOW_HOLD_MS = 48 * HOUR_MS;
const SIGNAL_HOLD_MS = 24 * HOUR_MS;
const SETTLE_RETRY_MS = 2 * HOUR_MS;
const LIMIT_RETRY_MS = 6 * HOUR_MS;
const MAX_HOLDS = 3;
const MIN_SAMPLE = 50;

export const LIMIT_TIERS = [
  { value: "TIER_250", label: "250 a day", limit: 250 },
  { value: "TIER_2K", label: "2,000 a day", limit: 2_000 },
  { value: "TIER_10K", label: "10,000 a day", limit: 10_000 },
  { value: "TIER_100K", label: "100,000 a day", limit: 100_000 },
  { value: "TIER_UNLIMITED", label: "Unlimited", limit: Number.POSITIVE_INFINITY },
];

export function recommendedPlan(): RolloutPlan {
  return { shares: [...RECOMMENDED_SHARES], gapDays: 1, engagedFirst: true };
}

export function normaliseTier(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return tierFromLimit(raw);
  if (typeof raw !== "string") return undefined;
  const text = raw.trim().toUpperCase().replace(/^TIER_/, "");
  if (!text) return undefined;
  if (text.includes("UNLIMITED")) return "TIER_UNLIMITED";
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([KM])?$/);
  if (!match) return undefined;
  const scale = match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
  return tierFromLimit(Number(match[1]) * scale);
}

export function tierFromLimit(limit: number): string {
  if (limit < 0 || limit >= 1_000_000) return "TIER_UNLIMITED";
  if (limit >= 1_000 && limit % 1_000 === 0) return `TIER_${limit / 1_000}K`;
  return `TIER_${Math.round(limit)}`;
}

export function dailyLimit(tier: string | undefined | null): number | null {
  if (!tier) return null;
  const text = tier.toUpperCase().replace(/^TIER_/, "");
  if (text === "UNLIMITED") return Number.POSITIVE_INFINITY;
  const match = text.match(/^(\d+)(K)?$/);
  if (!match) return null;
  return Number(match[1]) * (match[2] ? 1_000 : 1);
}

export function limitLabel(tier: string | undefined | null): string {
  const limit = dailyLimit(tier);
  if (limit === null) return "Unknown";
  if (!Number.isFinite(limit)) return "Unlimited";
  return `${limit.toLocaleString()} a day`;
}

export function normaliseQuality(raw: unknown): Quality {
  if (typeof raw !== "string") return "UNKNOWN";
  const text = raw.trim().toUpperCase();
  if (text === "GREEN" || text === "HIGH") return "GREEN";
  if (text === "YELLOW" || text === "MEDIUM") return "YELLOW";
  if (text === "RED" || text === "LOW" || text === "FLAGGED") return "RED";
  return "UNKNOWN";
}

export function safeDaily(limit: number | null): number {
  const value = limit ?? ASSUMED_LIMIT;
  return Number.isFinite(value) ? Math.floor(value * SAFETY) : Number.POSITIVE_INFINITY;
}

export function validPlan(plan: Pick<RolloutPlan, "shares" | "gapDays">): string | null {
  if (plan.shares.length === 0) return "Add at least one wave.";
  if (plan.shares.length > MAX_WAVES) return `Keep it to ${MAX_WAVES} waves or fewer.`;
  if (plan.shares.some((share) => !Number.isInteger(share) || share < 1 || share > 100)) {
    return "Each wave needs a whole percentage between 1 and 100.";
  }
  const total = plan.shares.reduce((sum, share) => sum + share, 0);
  if (total !== 100) return `The waves add up to ${total}%. Make them 100%.`;
  if (!Number.isInteger(plan.gapDays) || plan.gapDays < 1 || plan.gapDays > 7) {
    return "Leave 1 to 7 days between waves.";
  }
  return null;
}

export function waveTargets(total: number, shares: number[]): number[] {
  if (total <= 0) return [];
  if (total <= MIN_WAVE || shares.length <= 1) return [total];
  const raw = shares.map((share) => Math.round((total * share) / 100));
  raw[raw.length - 1] = total - raw.slice(0, -1).reduce((sum, size) => sum + size, 0);
  const targets: number[] = [];
  let carry = 0;
  for (const [index, size] of raw.entries()) {
    const value = size + carry;
    if (value < MIN_WAVE && index < raw.length - 1) {
      carry = value;
      continue;
    }
    carry = 0;
    targets.push(value);
  }
  const last = targets.length - 1;
  if (last > 0 && targets[last] < MIN_WAVE) {
    targets[last - 1] += targets[last];
    targets.pop();
  }
  return targets.filter((size) => size > 0);
}

const DAY_MS = 24 * HOUR_MS;

export type PlannedWave = {
  wave: number;
  step: number;
  date: string;
  size: number;
  continued: boolean;
  capped: boolean;
};

export function planWaves(input: {
  reachable: number;
  shares: number[];
  gapDays: number;
  limit: number | null;
  used24h: number;
  startDate: string;
}): { waves: PlannedWave[]; safeDaily: number; days: number } {
  const daily = safeDaily(input.limit);
  const targets = waveTargets(input.reachable, input.shares);
  const waves: PlannedWave[] = [];
  let day = 0;
  let firstDayRoom = Math.max(0, daily - input.used24h);
  for (const [step, target] of targets.entries()) {
    let left = target;
    let continued = false;
    while (left > 0 && waves.length < 60) {
      const room = day === 0 ? firstDayRoom : daily;
      if (room < Math.min(MIN_WAVE, left)) {
        day += 1;
        firstDayRoom = daily;
        continue;
      }
      const size = Math.min(left, room);
      left -= size;
      waves.push({
        wave: waves.length + 1,
        step,
        date: addDays(input.startDate, day),
        size,
        continued,
        capped: left > 0,
      });
      continued = true;
      day += left > 0 ? 1 : input.gapDays;
    }
  }
  const lastDay = waves.length ? waves[waves.length - 1].date : input.startDate;
  return {
    waves,
    safeDaily: daily,
    days: Math.round((Date.parse(lastDay) - Date.parse(input.startDate)) / DAY_MS) + 1,
  };
}

export function scoreContact(
  contact: {
    lastRepliedAt?: number;
    lastInboundAt?: number;
    lastReadAt?: number;
    lastOrderAt?: number;
  },
  now: number
): number {
  const within = (at: number | undefined, days: number) => at !== undefined && now - at <= days * DAY_MS;
  if (within(contact.lastRepliedAt, 30) || within(contact.lastInboundAt, 30) || within(contact.lastOrderAt, 90)) {
    return 3;
  }
  if (within(contact.lastReadAt, 60) || within(contact.lastInboundAt, 180)) return 2;
  if (contact.lastReadAt || contact.lastInboundAt || contact.lastRepliedAt || contact.lastOrderAt) return 1;
  return 0;
}

export function rateFor(size: number): number {
  return Math.min(300, Math.max(30, Math.ceil(size / 120)));
}

export function usedSince(hours: Array<{ hour: number; sent: number }>, now: number): number {
  const from = Math.floor(now / HOUR_MS) - 23;
  return hours.filter((row) => row.hour >= from).reduce((sum, row) => sum + Math.max(0, row.sent), 0);
}

function freesAt(
  hours: Array<{ hour: number; sent: number }>,
  now: number,
  excess: number
): number {
  const from = Math.floor(now / HOUR_MS) - 23;
  let freed = 0;
  for (const row of [...hours].filter((r) => r.hour >= from).sort((a, b) => a.hour - b.hour)) {
    freed += Math.max(0, row.sent);
    if (freed >= excess) return (row.hour + 24) * HOUR_MS + 10 * 60 * 1000;
  }
  return now + LIMIT_RETRY_MS;
}

export type WaveMetrics = {
  sent: number;
  failed: number;
  delivered: number;
  optedOut: number;
  heldBack: number;
  blocked: number;
  unreachable: number;
};

export type Decision =
  | { kind: "launch"; size: number; reason: string }
  | { kind: "hold"; until: number; shrink?: number; reason: string }
  | { kind: "wait"; until: number; reason: string }
  | { kind: "pause"; reason: string }
  | { kind: "finish"; reason: string };

const percent = (value: number) => `${(Math.round(value * 1000) / 10).toLocaleString()}%`;

export function decide(input: {
  now: number;
  quality: Quality;
  limit: number | null;
  hours: Array<{ hour: number; sent: number }>;
  templateBlocker: string | null;
  templateQuality?: string;
  previous: WaveMetrics | null;
  waveEndedAt?: number;
  queued: number;
  target: number;
  lastSize?: number;
  shrink?: number;
  holds: number;
  heldForWave: boolean;
}): Decision {
  const { now, previous } = input;
  if (input.queued <= 0) return { kind: "finish", reason: "Everyone in the plan has been sent to." };
  if (input.templateBlocker) return { kind: "pause", reason: input.templateBlocker };
  if (input.quality === "RED") {
    return { kind: "pause", reason: "Your WhatsApp number's quality is red. Sending more now risks a ban." };
  }
  const templateQuality = normaliseQuality(input.templateQuality);
  if (templateQuality === "RED") {
    return { kind: "pause", reason: "Meta rated this template's quality red. Change the message before sending more." };
  }

  let signal: string | null = null;
  if (previous) {
    if (previous.blocked > 0) {
      return { kind: "pause", reason: "WhatsApp refused messages for spam or policy. Stopped to protect your number." };
    }
    const attempted = previous.sent + previous.failed;
    const settled = previous.delivered + previous.failed >= 0.8 * attempted;
    if (!settled && input.waveEndedAt !== undefined && now - input.waveEndedAt < SETTLE_MS) {
      return { kind: "wait", until: now + SETTLE_RETRY_MS, reason: "Waiting for the last wave's delivery reports." };
    }
    const optOut = previous.delivered >= MIN_SAMPLE ? previous.optedOut / previous.delivered : 0;
    const failure =
      attempted >= MIN_SAMPLE
        ? Math.max(0, previous.failed - previous.heldBack - previous.unreachable) / attempted
        : 0;
    const heldBack = attempted >= MIN_SAMPLE ? previous.heldBack / attempted : 0;
    if (optOut >= 0.03) {
      return { kind: "pause", reason: `${percent(optOut)} of people unsubscribed after the last wave. Stopped before more do.` };
    }
    if (failure >= 0.2) {
      return { kind: "pause", reason: `${percent(failure)} of the last wave failed. Stopped to find out why.` };
    }
    if (optOut >= 0.015) signal = `${percent(optOut)} unsubscribed after the last wave.`;
    else if (heldBack >= 0.25) signal = `Meta held back ${percent(heldBack)} of the last wave to protect engagement.`;
  }

  const yellow =
    input.quality === "YELLOW"
      ? "Your WhatsApp number's quality turned yellow."
      : templateQuality === "YELLOW"
        ? "Meta rated this template's quality yellow."
        : null;
  if (yellow || (signal && !input.heldForWave)) {
    if (input.holds >= MAX_HOLDS) {
      return { kind: "pause", reason: `${yellow ?? signal} Held ${MAX_HOLDS} times in a row, so it is paused for you to decide.` };
    }
    return yellow
      ? { kind: "hold", until: now + YELLOW_HOLD_MS, shrink: 0.5, reason: `${yellow} Waiting 48 hours, then the next wave is halved.` }
      : { kind: "hold", until: now + SIGNAL_HOLD_MS, shrink: 0.5, reason: `${signal} Waiting a day, then the next wave is halved.` };
  }

  const daily = safeDaily(input.limit);
  const used = usedSince(input.hours, now);
  const room = daily - used;
  const wanted = Math.min(input.target, input.queued);
  const needed = Math.min(MIN_WAVE, wanted);
  if (room < needed) {
    const until = Math.min(now + DAY_MS, Math.max(now + 10 * 60 * 1000, freesAt(input.hours, now, needed - room)));
    return {
      kind: "wait",
      until,
      reason: `${used.toLocaleString()} sent in the last 24 hours, near your safe daily limit of ${daily.toLocaleString()}.`,
    };
  }

  let size = Math.min(wanted, Number.isFinite(room) ? room : wanted);
  if (input.shrink && input.lastSize) {
    size = Math.min(size, Math.max(MIN_WAVE, Math.round(input.lastSize * input.shrink)));
  }
  size = Math.max(1, Math.min(size, input.queued));
  const notes = [
    input.quality === "GREEN" ? "Quality is green" : input.quality === "UNKNOWN" ? "Quality could not be read" : null,
    size < wanted ? `cut to fit the safe daily limit of ${daily.toLocaleString()}` : null,
  ].filter(Boolean);
  return {
    kind: "launch",
    size,
    reason: `Sending to ${size.toLocaleString()}${notes.length ? ` — ${notes.join(", ")}` : ""}.`,
  };
}

export function nextCheckAt(input: {
  waveStartedAt: number;
  waveEndedAt: number;
  sendHour: number;
  gapDays: number;
  timeZone: string;
}): number {
  const startDate = zonedParts(input.waveStartedAt, input.timeZone).date;
  let at = zonedToInstant(addDays(startDate, input.gapDays), input.sendHour, input.timeZone);
  while (at < input.waveEndedAt + MIN_WATCH_MS) at += DAY_MS;
  return at;
}
