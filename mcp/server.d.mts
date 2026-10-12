// Types for the plain-JS MCP server, so the Next route handler can import it.
// server.mjs is JavaScript on purpose: it also runs as a standalone stdio
// process for Claude Code and Claude Desktop, with no build step.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * `full` registers every tool. `workspace` — a company's own connector — only
 * the reads and send_message.
 */
export type McpScope = "full" | "workspace";

/**
 * A server instance with its scope's tools registered. One instance binds to
 * exactly one transport, so ask for a new one per client session.
 */
export function buildServer(options?: { scope?: McpScope }): McpServer;

export type McpTool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
};

export type McpToolGroup = { title: string; admin: boolean; tools: McpTool[] };

/** Every tool's name and description, grouped, without building a server. */
export function toolCatalogue(scope?: McpScope): McpToolGroup[];

/** Signs in to Convex and refreshes the access token. Throws if unconfigured. */
export function authorize(): Promise<void>;

/** Who the server is signed in as — for a log line. */
export function describeSession(): string;

/**
 * The account a request acts as. `null` means the environment-configured one,
 * which is what the stdio server and the deployment-wide token both use.
 */
export type McpSession = {
  sessionToken: string;
  role: "workspace" | "admin";
  label: string;
  workspaceSlug: string | null;
};

export type McpIdentity =
  | { kind: "token"; token: string }
  | { kind: "session"; session: McpSession }
  | null;

/**
 * Verifies a connector token and returns its session, or null when no such
 * token was issued. Call it before serving MCP to a URL-supplied token.
 */
export function verifyConnectorToken(token: string): Promise<McpSession | null>;

/**
 * Runs `fn` with its own identity and its own derived state — Convex client,
 * session, access token, workspace cache.
 *
 * Required for anything serving more than one account from one process: those
 * are per-module by default, and a warm serverless instance reuses the module
 * between invocations.
 */
export function runWithIdentity<T>(
  identity: McpIdentity,
  fn: () => Promise<T>
): Promise<T>;
