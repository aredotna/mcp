import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createArenaClient, type ArenaClient } from "../client";

export function successResult(data: unknown): CallToolResult {
  const text = JSON.stringify({ result: data ?? null }, null, 2);
  const structuredContent: Record<string, unknown> = JSON.parse(text);
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

export function errorResult(error: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(error) }],
    isError: true,
  };
}

export function requireAuth(extra: { authInfo?: { token?: string } }): string {
  const token = extra.authInfo?.token;
  if (!token) throw new AuthRequiredError();
  return token;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

export function withArenaClient<T>(
  extra: { authInfo?: { token?: string } },
  fn: (client: ArenaClient) => Promise<T>,
): Promise<T> {
  const token = requireAuth(extra);
  const client = createArenaClient(token);
  return fn(client);
}
