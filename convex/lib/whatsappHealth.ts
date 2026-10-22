import { channelHeaders, panelRoot, request, type Json } from "./panel";
import { normaliseQuality, normaliseTier, type Quality } from "./rollout";

export type HealthReading = {
  ok: boolean;
  quality: Quality;
  limitTier?: string;
  throughput?: string;
};

const FIELDS = "quality_rating,whatsapp_business_manager_messaging_limit,messaging_limit_tier,throughput";

function find(node: unknown, keys: RegExp, depth = 0): unknown {
  if (!node || typeof node !== "object" || depth > 5) return undefined;
  for (const [key, value] of Object.entries(node as Json)) {
    if (keys.test(key) && value !== null && value !== undefined) return value;
  }
  for (const value of Object.values(node as Json)) {
    const hit = find(value, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function tierOf(value: unknown): string | undefined {
  const direct = normaliseTier(value);
  if (direct) return direct;
  if (value && typeof value === "object") {
    for (const inner of Object.values(value as Json)) {
      const tier = normaliseTier(inner);
      if (tier) return tier;
    }
  }
  return undefined;
}

export function healthFrom(body: unknown): Omit<HealthReading, "ok"> {
  const quality = normaliseQuality(find(body, /^quality_rating$/i));
  const limitTier =
    tierOf(find(body, /^whatsapp_business_manager_messaging_limit$/i)) ??
    tierOf(find(body, /^(messaging_limit_tier|messaging_limit|current_limit)$/i));
  const throughput = find(body, /^throughput$/i);
  const level =
    typeof throughput === "string"
      ? throughput
      : typeof (throughput as Json | undefined)?.level === "string"
        ? String((throughput as Json).level)
        : undefined;
  return { quality, limitTier, throughput: level };
}

export async function readHealth(channel: {
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<HealthReading> {
  const root = panelRoot(channel);
  for (const url of [`${root}/${channel.phoneNumberId}?fields=${FIELDS}`, `${root}/info`]) {
    try {
      const response = await request(url, { method: "GET", headers: channelHeaders(channel) }, 10_000);
      if (!response.ok) continue;
      const reading = healthFrom(response.body);
      if (reading.quality !== "UNKNOWN" || reading.limitTier) return { ok: true, ...reading };
    } catch {
      continue;
    }
  }
  return { ok: false, quality: "UNKNOWN" };
}
