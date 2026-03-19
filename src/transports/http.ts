import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  OAuthClientInformationFullSchema,
  OAuthMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpServer } from "../server";
import { ArenaOAuthProvider } from "../auth/provider";

interface Env {
  ARENA_OAUTH_CLIENT_ID: string;
  ARENA_OAUTH_CLIENT_SECRET: string;
  OAUTH_CLIENTS: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

function getProvider(env: Env) {
  return new ArenaOAuthProvider({
    clientId: env.ARENA_OAUTH_CLIENT_ID,
    clientSecret: env.ARENA_OAUTH_CLIENT_SECRET,
    kvStore: env.OAUTH_CLIENTS,
  });
}

function getIssuerUrl(c: { req: { url: string } }): URL {
  const url = new URL(c.req.url);
  return new URL(`${url.protocol}//${url.host}`);
}

// OAuth Authorization Server Metadata (RFC 8414)
app.get("/.well-known/oauth-authorization-server", (c) => {
  const issuer = getIssuerUrl(c);
  const metadata = {
    issuer: issuer.href,
    authorization_endpoint: new URL("/authorize", issuer).href,
    token_endpoint: new URL("/token", issuer).href,
    registration_endpoint: new URL("/register", issuer).href,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["read", "write"],
  };
  return c.json(metadata);
});

// Protected Resource Metadata (RFC 9728)
app.get("/.well-known/oauth-protected-resource", (c) => {
  const issuer = getIssuerUrl(c);
  return c.json({
    resource: issuer.href,
    authorization_servers: [issuer.href],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "Are.na MCP Server",
    resource_documentation: "https://dev.are.na/documentation",
  });
});

// Dynamic Client Registration (RFC 7591)
app.post("/register", async (c) => {
  const provider = getProvider(c.env);
  const body = await c.req.json();

  const clientId = crypto.randomUUID();
  const clientInfo = {
    ...body,
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };

  const registered = await provider.clientsStore.registerClient!(
    OAuthClientInformationFullSchema.parse(clientInfo),
  );

  return c.json(registered, 201);
});

// Authorization endpoint — redirect to Are.na OAuth
app.get("/authorize", async (c) => {
  const provider = getProvider(c.env);

  const clientId = c.req.query("client_id");
  if (!clientId) {
    return c.json({ error: "client_id required" }, 400);
  }

  const client = await provider.clientsStore.getClient(clientId);
  if (!client) {
    return c.json({ error: "Unknown client" }, 400);
  }

  const url = new URL("https://www.are.na/oauth/authorize");
  url.searchParams.set("client_id", c.env.ARENA_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");

  const redirectUri = c.req.query("redirect_uri");
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);

  const state = c.req.query("state");
  if (state) url.searchParams.set("state", state);

  const codeChallenge = c.req.query("code_challenge");
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set(
      "code_challenge_method",
      c.req.query("code_challenge_method") ?? "S256",
    );
  }

  const scope = c.req.query("scope");
  if (scope) url.searchParams.set("scope", scope);

  return c.redirect(url.toString());
});

// Token endpoint — proxy to Are.na
app.post("/token", async (c) => {
  const provider = getProvider(c.env);
  const body = await c.req.parseBody();

  const grantType = body["grant_type"] as string;
  const clientId = body["client_id"] as string;

  if (!clientId) {
    return c.json({ error: "client_id required" }, 400);
  }

  const client = await provider.clientsStore.getClient(clientId);
  if (!client) {
    return c.json({ error: "Unknown client" }, 400);
  }

  try {
    let tokens;
    if (grantType === "authorization_code") {
      tokens = await provider.exchangeAuthorizationCode(
        client,
        body["code"] as string,
        body["code_verifier"] as string | undefined,
        body["redirect_uri"] as string | undefined,
      );
    } else if (grantType === "refresh_token") {
      tokens = await provider.exchangeRefreshToken(
        client,
        body["refresh_token"] as string,
        body["scope"] ? (body["scope"] as string).split(" ") : undefined,
      );
    } else {
      return c.json({ error: "unsupported_grant_type" }, 400);
    }

    return c.json(tokens);
  } catch (err) {
    return c.json(
      { error: "invalid_grant", error_description: String(err) },
      400,
    );
  }
});

// Bearer token extraction and verification middleware
async function extractAuthInfo(
  env: Env,
  request: Request,
): Promise<AuthInfo | undefined> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return undefined;

  const token = authHeader.slice(7);
  const provider = getProvider(env);

  try {
    return await provider.verifyAccessToken(token);
  } catch {
    return undefined;
  }
}

// MCP Streamable HTTP endpoint
app.all("/mcp", async (c) => {
  const authInfo = await extractAuthInfo(c.env, c.req.raw);

  if (!authInfo && c.req.method === "POST") {
    return c.json(
      { error: "Unauthorized", message: "Bearer token required" },
      401,
    );
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  await server.connect(transport);

  const response = await transport.handleRequest(c.req.raw, {
    authInfo,
  });

  return response;
});

export default app;
