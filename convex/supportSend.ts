import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { normaliseEmail, platformFrom, sendPlatformEmail } from "./lib/notifications";
import { supportEmailHtml } from "./lib/platformEmail";
import { publicSiteUrl } from "./lib/publicUrl";
import { ticketRef } from "./lib/support";

export const toClient = internalAction({
  args: { ticketId: v.id("supportTickets"), title: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.support.sendContext, { ticketId: args.ticketId });
    if (!context?.workspace) return;
    const { ticket, workspace } = context;
    const to = normaliseEmail(ticket.requesterEmail ?? workspace.supportEmail ?? "");
    if (!to) return;
    const outcome = await sendPlatformEmail({
      to: [to],
      subject: `${args.title} — ${ticket.subject}`,
      html: supportEmailHtml({
        reference: ticketRef(ticket.number),
        heading: args.title,
        body: args.message,
        link: `${publicSiteUrl()}/w/${workspace.slug}/support/${ticket._id}`,
        linkLabel: "Open ticket",
        brand: platformFrom().fromName,
      }),
    });
    if (!outcome.ok) console.error("support email to client failed", outcome.error);
  },
});

export const toStaff = internalAction({
  args: {
    ticketId: v.id("supportTickets"),
    title: v.string(),
    message: v.string(),
    adminIds: v.optional(v.array(v.id("admins"))),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.support.sendContext, { ticketId: args.ticketId });
    if (!context) return;
    const { ticket, workspace, staff } = context;
    const recipients = staff
      .filter((member) => (args.adminIds ? args.adminIds.includes(member._id) : true))
      .flatMap((member) => normaliseEmail(member.email) ?? []);
    if (recipients.length === 0) return;
    const outcome = await sendPlatformEmail({
      to: [...new Set(recipients)],
      subject: `${args.title} · ${workspace?.name ?? "Workspace"}`,
      html: supportEmailHtml({
        reference: ticketRef(ticket.number),
        heading: args.title,
        body: `${workspace?.name ?? "A workspace"} · ${ticket.requesterName}\n\n${args.message}`,
        link: `${publicSiteUrl()}/admin/support/${ticket._id}`,
        linkLabel: "Open in support inbox",
        brand: platformFrom().fromName,
      }),
    });
    if (!outcome.ok) console.error("support email to staff failed", outcome.error);
  },
});
