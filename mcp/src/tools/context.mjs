/**
 * Context tools — what this server can see and which workspace it is on.
 */

import { z } from "zod";
import { kvArg, workspaceArg } from "../args.mjs";
import { DEFAULT_WORKSPACE } from "../config.mjs";
import { api, authorize, call, currentSession, state } from "../convex.mjs";
import { fileSourceArgs, guessMime, loadFile } from "../files.mjs";
import { handler, ok } from "../results.mjs";
import { reachableWorkspaces, resolveWorkspace } from "../workspaces.mjs";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const logoMime = (filename, given) =>
  /\.svg$/i.test(filename) ? "image/svg+xml" : guessMime(filename, given);

async function logoBytes(workspaceId, file) {
  if (file.bytes) return { ...file, mimeType: file.mimeType ?? logoMime(file.filename) };
  const url = await call.query(api.workspaces.ownFileUrl, { workspaceId, key: file.fileKey });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Nothing has been uploaded to ${file.fileKey}.`);
  return {
    ...file,
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: logoMime(file.filename, response.headers.get("content-type")),
  };
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "The account this server is signed in as, and the workspaces it can reach. Start here when unsure of scope.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      await authorize();
      const all = await reachableWorkspaces();
      const session = currentSession();
      return ok({
        signedInAs: session.label,
        role: session.role,
        defaultWorkspace: DEFAULT_WORKSPACE ?? session.workspaceSlug ?? null,
        workspaces: all.map((w) => ({ slug: w.slug, name: w.name, status: w.status })),
      });
    })
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "Every workspace this account can reach, with counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      const all = await reachableWorkspaces();
      const out = [];
      for (const workspace of all) {
        const summary = await call.query(api.workspaces.summary, {
          workspaceId: workspace._id,
        });
        out.push({
          slug: workspace.slug,
          name: workspace.name,
          industry: workspace.industry ?? null,
          currency: workspace.currency,
          status: workspace.status,
          counts: summary,
        });
      }
      return ok(out);
    })
  );

  server.registerTool(
    "get_workspace",
    {
      title: "Get workspace",
      description:
        "The workspace profile: company details, locale, currency, webhook, and the facts injected into every agent prompt.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const summary = await call.query(api.workspaces.summary, {
        workspaceId: found._id,
      });
      return ok({
        slug: found.slug,
        name: found.name,
        ownerName: found.ownerName ?? null,
        tagline: found.tagline ?? null,
        description: found.description ?? null,
        industry: found.industry ?? null,
        website: found.website ?? null,
        supportEmail: found.supportEmail ?? null,
        supportPhone: found.supportPhone ?? null,
        address: found.address ?? null,
        locale: found.locale,
        timezone: found.timezone,
        currency: found.currency,
        logo: found.logoSrc ?? null,
        theme: found.theme ?? "default (green)",
        webhookUrl: found.webhookUrl ?? null,
        facts: found.facts,
        status: found.status,
        counts: summary,
      });
    })
  );

  server.registerTool(
    "update_workspace",
    {
      title: "Update workspace",
      description:
        "Change the company profile. Everything here reaches every agent's system prompt, so it is the cheapest way to make all of them more accurate at once. Omitted fields are left alone.",
      inputSchema: {
        ...workspaceArg,
        name: z.string().optional(),
        ownerName: z
          .string()
          .optional()
          .describe(
            "Who runs the workspace, as they want to be addressed. Used when an agent speaks to the operator rather than a customer — the spoken introduction greets this name. Send an empty string to clear it."
          ),
        tagline: z.string().optional(),
        description: z.string().optional(),
        industry: z.string().optional(),
        website: z.string().optional(),
        supportEmail: z.string().optional(),
        supportPhone: z.string().optional(),
        address: z.string().optional(),
        locale: z.string().optional().describe("e.g. en-GB"),
        timezone: z.string().optional().describe("e.g. Europe/London"),
        currency: z.string().optional().describe("ISO code, e.g. GBP"),
        webhookUrl: z
          .string()
          .optional()
          .describe("Where record, escalation and Magic app events are POSTed"),
        facts: z
          .array(kvArg)
          .optional()
          .describe(
            "Replaces the whole list. Arbitrary company facts every agent may state — opening hours, delivery areas, lead times."
          ),
      },
    },
    handler(async ({ workspace, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      await call.mutation(api.workspaces.update, {
        workspaceId: found._id,
        ...fields,
      });
      state().workspaces.delete(found.slug);
      return ok(`Updated ${found.name}.`);
    })
  );

  server.registerTool(
    "set_workspace_logo",
    {
      title: "Set the company logo",
      description:
        "Replace the company logo shown in the console, the web chat and emails. Pass one image (PNG, JPG, WebP, GIF or SVG, up to 2 MB) as a fileKey, url or contentBase64 — it is copied into the workspace's logo storage. Pass clear: true instead to go back to the Magic Agent mark.",
      inputSchema: {
        ...workspaceArg,
        ...fileSourceArgs,
        filename: z
          .string()
          .optional()
          .describe("e.g. 'logo.png'. Required with contentBase64 or fileKey; defaults to the URL's last segment."),
        clear: z.boolean().optional().describe("Remove the logo instead of setting one"),
      },
    },
    handler(async ({ workspace, clear, ...source }) => {
      const found = await resolveWorkspace(workspace);
      if (clear) {
        await call.mutation(api.workspaces.clearLogo, { workspaceId: found._id });
        state().workspaces.delete(found.slug);
        return ok(`Removed the logo from ${found.name}.`);
      }

      const file = await logoBytes(found._id, await loadFile(source));
      if (!file.mimeType?.startsWith("image/")) {
        throw new Error(`${file.filename} is not an image. Use a PNG, JPG, WebP, GIF or SVG.`);
      }
      if (file.bytes.byteLength > MAX_LOGO_BYTES) {
        throw new Error(`${file.filename} is over 2 MB. A PNG or SVG of the mark is plenty.`);
      }

      const target = await call.mutation(api.workspaces.generateLogoUploadUrl, {
        workspaceId: found._id,
      });
      const put = await fetch(target.url, {
        method: "PUT",
        headers: { "Content-Type": file.mimeType },
        body: file.bytes,
      });
      if (!put.ok) throw new Error(`Uploading ${file.filename} failed with HTTP ${put.status}`);

      await call.mutation(api.workspaces.setLogo, { workspaceId: found._id, key: target.key });
      state().workspaces.delete(found.slug);
      return ok(`Set ${file.filename} as the logo of ${found.name}.`);
    })
  );

  server.registerTool(
    "get_welcome_menu",
    {
      title: "Welcome menu",
      description:
        "The message and buttons the front desk sends, instead of an AI reply, when a customer opens a chat (first message, or after 12 hours of quiet) with only a greeting or no clear request. 'effective' is what goes out now; empty saved options mean the buttons come from the live agents.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const menu = await call.query(api.welcomeMenu.get, { workspaceId: found._id });
      return ok(menu);
    })
  );

  server.registerTool(
    "update_welcome_menu",
    {
      title: "Update the welcome menu",
      description:
        "Replace the welcome menu. Up to 3 options go out as WhatsApp reply buttons, 4–10 as a list behind buttonText. Titles are cut to 20 characters, descriptions (list only) to 72. Pass options: [] to keep the buttons following the live agents, and an empty body for the default greeting. Pictures are set in the console and kept for options whose title stays the same; when every option has one, the menu goes out as an image carousel.",
      inputSchema: {
        ...workspaceArg,
        enabled: z.boolean(),
        body: z.string().describe("The message above the buttons; empty for the default"),
        header: z.string().optional(),
        footer: z.string().optional(),
        buttonText: z.string().optional().describe("List button label, for 4 or more options"),
        options: z
          .array(z.object({ title: z.string(), description: z.string().optional() }))
          .max(10),
      },
    },
    handler(async ({ workspace, ...menu }) => {
      const found = await resolveWorkspace(workspace);
      const current = await call.query(api.welcomeMenu.get, { workspaceId: found._id });
      const images = new Map(
        (current?.saved?.options ?? [])
          .filter((option) => option.imageKey)
          .map((option) => [option.title.trim().toLowerCase(), option.imageKey])
      );
      const saved = await call.mutation(api.welcomeMenu.save, {
        workspaceId: found._id,
        menu: {
          ...menu,
          ...(current?.saved?.headerImageKey
            ? { headerImageKey: current.saved.headerImageKey }
            : {}),
          options: menu.options.map((option) => {
            const imageKey = images.get(option.title.trim().toLowerCase());
            return imageKey ? { ...option, imageKey } : option;
          }),
        },
      });
      return ok(saved);
    })
  );
}
