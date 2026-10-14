import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const burstArgs = {
  channelId: v.id("channels"),
  from: v.string(),
  wamid: v.string(),
};

export const noteImage = internalMutation({
  args: burstArgs,
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("whatsappImageBursts")
      .withIndex("by_channel_from", (q) =>
        q.eq("channelId", args.channelId).eq("from", args.from)
      )
      .unique();
    if (row) await ctx.db.patch(row._id, { wamid: args.wamid });
    else await ctx.db.insert("whatsappImageBursts", args);
  },
});

/** True when no later photo arrived from this sender while this one waited. */
export const claimImage = internalMutation({
  args: burstArgs,
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("whatsappImageBursts")
      .withIndex("by_channel_from", (q) =>
        q.eq("channelId", args.channelId).eq("from", args.from)
      )
      .unique();
    if (row && row.wamid !== args.wamid) return false;
    if (row) await ctx.db.delete(row._id);
    return true;
  },
});
