import { toolCatalogue } from "@/mcp/server.mjs";

export const dynamic = "force-static";

export function GET() {
  return Response.json(toolCatalogue("workspace"));
}
