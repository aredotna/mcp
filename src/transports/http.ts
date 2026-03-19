import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpServer } from "../server";

interface Env {
  ARENA_ACCESS_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({
    name: "@aredotna/mcp",
    version: "0.1.0",
    transport: "streamable-http",
    endpoint: "/mcp",
    docs: "https://github.com/aredotna/mcp",
  });
});

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7);
}

app.all("/mcp", async (c) => {
  const token = extractBearerToken(c.req.raw) ?? c.env.ARENA_ACCESS_TOKEN;

  if (!token) {
    return c.json(
      { error: "Unauthorized", message: "Bearer token required" },
      401,
    );
  }

  const authInfo: AuthInfo = {
    token,
    clientId: "http",
    scopes: [],
  };

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  return transport.handleRequest(c.req.raw, { authInfo });
});

export default app;
