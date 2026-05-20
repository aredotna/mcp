import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createArenaClient, type ArenaClient } from "../client";

function stringifyResult(data: unknown): string {
  return JSON.stringify(data, null, 2) ?? "null";
}

function isStructuredObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

export function textResult(
  data: unknown,
  structuredContent?: Record<string, unknown>,
): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: "text", text: stringifyResult(data) }],
  };

  const structured =
    structuredContent ?? (isStructuredObject(data) ? data : undefined);
  if (structured) result.structuredContent = structured;

  return result;
}

export function dataResult(data: unknown): CallToolResult {
  return textResult(data, { data: data ?? null });
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
