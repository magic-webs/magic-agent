import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";

export async function bumpLeadCount(
  db: DatabaseWriter,
  stageId: Id<"leadStages">,
  delta: number
) {
  const stage = await db.get("leadStages", stageId);
  if (!stage) return;
  await db.patch("leadStages", stageId, {
    leadCount: Math.max(0, (stage.leadCount ?? 0) + delta),
  });
}
