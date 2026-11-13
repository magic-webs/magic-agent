export const CARRIED_REPLIES = 3;

type ReplyLike<Id> = {
  role: string;
  sentByHuman?: boolean;
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
