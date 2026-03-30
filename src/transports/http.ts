import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpServer } from "../server";
import { oauthRoutes } from "../auth/routes";

interface Env {
  ARENA_ACCESS_TOKEN?: string;
  OAUTH_KV: KVNamespace;
  ARENA_OAUTH_CLIENT_ID: string;
  ARENA_OAUTH_CLIENT_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({
    name: "@aredotna/mcp",
    version: "0.1.0",
    transport: "streamable-http",
    endpoint: "/mcp",
    url: "https://mcp.are.na/mcp",
    docs: "https://github.com/aredotna/mcp",
  });
});

// OAuth 2.1 routes (metadata, DCR, authorize, callback, token)
app.route("/", oauthRoutes);

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7);
}

app.get("/mcp", (c) => {
  return c.json(
    { error: "Method Not Allowed", message: "Use POST for MCP requests" },
    405,
  );
});

app.post("/mcp", async (c) => {
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

app.delete("/mcp", async (c) => {
  return c.json({ message: "Session ended" }, 200);
});

export default app;
