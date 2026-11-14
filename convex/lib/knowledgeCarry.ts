export const CARRIED_REPLIES = 3;

type ReplyLike<Id> = {
  role: string;
  sentByHuman?: boolean;
  text?: string;
  knowledgeChunkIds?: Id[];
};

export function carriedChunkIds<Id>(
  newestFirst: ReplyLike<Id>[],
  replies = CARRIED_REPLIES
): Id[] {
  const out: Id[] = [];
  let seen = 0;
  for (const m of newestFirst) {
    if (seen >= replies) break;
    if (m.role !== "assistant" || m.sentByHuman) continue;
    seen++;
    for (const id of m.knowledgeChunkIds ?? []) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function mergePassages<P extends { chunkId: unknown }>(
  fresh: P[],
  carried: P[],
  cap: number
): P[] {
  const out: P[] = [];
  for (const p of [...fresh, ...carried]) {
    if (out.length >= cap) break;
    if (!out.some((q) => q.chunkId === p.chunkId)) out.push(p);
  }
  return out;
}

export function recentReplyTexts(
  newestFirst: ReplyLike<unknown>[],
  replies = CARRIED_REPLIES
): string[] {
  return newestFirst
    .filter((m) => m.role === "assistant" && !m.sentByHuman && m.text)
    .slice(0, replies)
    .map((m) => m.text!);
}

const COMMON = new Set(
  "about after again also because before being could every first great happy hello just know like little make makes more most much need other really should since some sounds sure thanks that their there these thing think this those through today very want what when where which while with would your yours".split(" ")
);

function numbers(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((raw) => Number(raw.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 2);
}

function sameFigure(said: number, source: number): boolean {
  if (said < 10 || source < 10) return said === Math.round(source);
  return Math.abs(said - source) / source <= 0.1;
}

function words(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const word of text.match(/[A-Za-z][A-Za-z'’-]{3,}/g) ?? []) {
    const key = word.toLowerCase().replace(/['’]s$/, "");
    if (COMMON.has(key)) continue;
    const weight = /^[A-Z]/.test(word) ? 2 : key.length >= 7 ? 1 : 0;
    if (weight > (out.get(key) ?? 0)) out.set(key, weight);
  }
  return out;
}

export function citedFirst<P extends { text: string }>(
  carried: P[],
  replyTexts: string[],
  minScore = 4
): { cited: P[]; rest: P[] } {
  const reply = replyTexts.join("\n");
  const saidWords = words(reply);
  const saidNumbers = numbers(reply);
  const scored = carried.map((passage) => {
    let score = 0;
    for (const [key] of words(passage.text)) score += saidWords.get(key) ?? 0;
    const figures = numbers(passage.text);
    for (const said of saidNumbers) {
      if (figures.some((source) => sameFigure(said, source))) score += 3;
    }
    return { passage, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return {
    cited: scored.filter((s) => s.score >= minScore).map((s) => s.passage),
    rest: scored.filter((s) => s.score < minScore).map((s) => s.passage),
  };
}
