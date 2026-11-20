/**
 * The server factory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "./tools/index.mjs";
import { FULL_INSTRUCTIONS } from "./instructions.mjs";

/**
 * Builds a server instance with the tools its scope allows — everything, or
 * for a company's connector everything but platform administration.
 *
 * A factory rather than a singleton: an McpServer binds to exactly one
 * transport, and the HTTP transport needs a fresh one per client session.
 * Authentication and the Convex client are module-level, so a new instance
 * costs nothing but the registrations.
 *
 * @param {{ scope?: "full" | "workspace" }} [options]
 */
export function buildServer({ scope = "full" } = {}) {
  const server = new McpServer(
    { name: "magic-agent", version: "1.0.0" },
    { instructions: FULL_INSTRUCTIONS }
  );

  registerAll(server, scope);

  return server;
}
