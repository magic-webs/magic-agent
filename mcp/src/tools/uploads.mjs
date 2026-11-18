/**
 * Direct uploads, for files too big to pass as base64: the caller PUTs the
 * bytes to a signed address and hands the fileKey to the tool that uses it.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { guessMime } from "../files.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

const EXPIRES_IN_SECONDS = 900;

const UPLOAD_URL_FOR = {
  catalogue: api.products.generateUploadUrl,
  knowledge: api.knowledge.generateUploadUrl,
};

const USED_BY = {
  catalogue:
    "create_product files or imageFiles, or update_product addFiles or addImages",
  knowledge: "upload_knowledge_file",
};

const shellQuote = (text) => `'${text.replace(/'/g, `'\\''`)}'`;

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "create_upload_url",
    {
      title: "Create an upload URL",
      description:
        "Get a signed address to upload a file directly, for anything too big to pass as contentBase64 — a brochure, price list, photo or document the user attached. PUT the file's bytes to uploadUrl within 15 minutes (the curl field is the exact command), then pass { fileKey, filename } to the tool named in useWith. Call it once per file. The upload host must be reachable from wherever the PUT runs.",
      inputSchema: {
        ...workspaceArg,
        destination: z
          .enum(["catalogue", "knowledge"])
          .describe("catalogue for product files and images; knowledge for the knowledge base"),
        filename: z.string().describe("The file's name with its extension, e.g. 'Datasheet.pdf'"),
      },
    },
    handler(async ({ workspace, destination, filename }) => {
      const name = filename.trim();
      if (!name) throw new Error("filename is required.");
      const found = await resolveWorkspace(workspace);
      const target = await call.mutation(UPLOAD_URL_FOR[destination], {
        workspaceId: found._id,
      });
      const contentType = guessMime(name) ?? "application/octet-stream";
      return ok({
        uploadUrl: target.url,
        uploadHost: new URL(target.url).host,
        method: "PUT",
        contentType,
        expiresInSeconds: EXPIRES_IN_SECONDS,
        fileKey: target.key,
        filename: name,
        curl: `curl -fsS -X PUT -H ${shellQuote(`Content-Type: ${contentType}`)} --data-binary @${shellQuote(name)} ${shellQuote(target.url)}`,
        useWith: USED_BY[destination],
      });
    })
  );
}
