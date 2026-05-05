/**
 * OAuth 2.1 routes for MCP authorization.
 *
 * Implements the third-party authorization flow: this server acts as an
 * OAuth authorization server to MCP clients while delegating actual user
 * authentication to Are.na's existing OAuth.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { OAuthStore } from "./store";
import { generateId, verifyPkce } from "./crypto";

const ARENA_AUTHORIZE_URL = "https://www.are.na/oauth/authorize";
const ARENA_TOKEN_URL = "https://api.are.na/v3/oauth/token";

interface OAuthEnv {
  OAUTH_KV: KVNamespace;
  ARENA_OAUTH_CLIENT_ID: string;
  ARENA_OAUTH_CLIENT_SECRET: string;
}

export const oauthRoutes = new Hono<{ Bindings: OAuthEnv }>();

function protectedResourceMetadata(c: Context<{ Bindings: OAuthEnv }>) {
  const origin = new URL(c.req.url).origin;

  return c.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read", "write"],
    resource_name: "Are.na MCP",
    resource_documentation: "https://github.com/aredotna/mcp",
  });
}

/**
 * RFC 9728 — Protected Resource Metadata
 */
oauthRoutes.get(
  "/.well-known/oauth-protected-resource",
  protectedResourceMetadata,
);
oauthRoutes.get(
  "/.well-known/oauth-protected-resource/mcp",
  protectedResourceMetadata,
);

/**
 * RFC 8414 — Authorization Server Metadata
 */
oauthRoutes.get("/.well-known/oauth-authorization-server", (c) => {
  const origin = new URL(c.req.url).origin;

  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: ["read", "write"],
  });
});

/**
 * RFC 7591 — Dynamic Client Registration
 */
oauthRoutes.post("/register", async (c) => {
  const body = await c.req.json<{
    redirect_uris?: string[];
    client_name?: string;
  }>();

  if (
    !body.redirect_uris ||
    !Array.isArray(body.redirect_uris) ||
    body.redirect_uris.length === 0
  ) {
    return c.json(
      {
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required",
      },
      400,
    );
  }

  const store = new OAuthStore(c.env.OAUTH_KV);

  const client_id = generateId(16);
  const client_secret = generateId(32);

  await store.putClient({
    client_id,
    client_secret,
    redirect_uris: body.redirect_uris,
    client_name: body.client_name,
    created_at: Date.now(),
  });

  return c.json(
    {
      client_id,
      client_secret,
      redirect_uris: body.redirect_uris,
      client_name: body.client_name,
      token_endpoint_auth_method: "client_secret_post",
    },
    201,
  );
});

/**
 * Authorization endpoint — validates params, stores PKCE state,
 * then redirects the user to Are.na's OAuth consent page.
 */
oauthRoutes.get("/authorize", async (c) => {
  const params = c.req.query();
  const {
    client_id,
    redirect_uri,
    response_type,
    code_challenge,
    code_challenge_method,
    state: clientState,
    scope,
  } = params;

  if (response_type !== "code") {
    return c.json(
      {
        error: "unsupported_response_type",
        error_description: "Only 'code' is supported",
      },
      400,
    );
  }

  if (!client_id || !redirect_uri || !code_challenge) {
    return c.json(
      {
        error: "invalid_request",
        error_description:
          "client_id, redirect_uri, and code_challenge are required",
      },
      400,
    );
  }

  if (code_challenge_method && code_challenge_method !== "S256") {
    return c.json(
      {
        error: "invalid_request",
        error_description: "Only S256 code_challenge_method is supported",
      },
      400,
    );
  }

  const store = new OAuthStore(c.env.OAUTH_KV);
  const client = await store.getClient(client_id);

  if (!client) {
    return c.json(
      { error: "invalid_client", error_description: "Unknown client_id" },
      401,
    );
  }

  if (!client.redirect_uris.includes(redirect_uri)) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "redirect_uri not registered for this client",
      },
      400,
    );
  }

  // Generate a state token that ties this flow together.
  // We encode the MCP client's state inside so we can return it on callback.
  const arenaState = generateId(16);

  await store.putAuthFlow(arenaState, {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method: code_challenge_method ?? "S256",
    scope,
    arena_state: arenaState,
  });

  // Also store the MCP client's original `state` so we can forward it back
  if (clientState) {
    await c.env.OAUTH_KV.put(`client_state:${arenaState}`, clientState, {
      expirationTtl: 600,
    });
  }

  const origin = new URL(c.req.url).origin;
  const arenaScope = scope === "read" ? "read" : "write";

  const arenaParams = new URLSearchParams({
    client_id: c.env.ARENA_OAUTH_CLIENT_ID,
    redirect_uri: `${origin}/callback`,
    response_type: "code",
    state: arenaState,
    scope: arenaScope,
  });

  return c.redirect(`${ARENA_AUTHORIZE_URL}?${arenaParams.toString()}`);
});

/**
 * OAuth callback from Are.na — exchanges the Are.na auth code for an
 * access token, generates an MCP auth code, and redirects back to the
 * MCP client's redirect_uri.
 */
oauthRoutes.get("/callback", async (c) => {
  const { code: arenaCode, state: arenaState, error } = c.req.query();

  if (error) {
    return c.text(`Authorization denied: ${error}`, 400);
  }

  if (!arenaCode || !arenaState) {
    return c.text("Missing code or state parameter", 400);
  }

  const store = new OAuthStore(c.env.OAUTH_KV);
  const flow = await store.getAuthFlow(arenaState);

  if (!flow) {
    return c.text("Invalid or expired authorization state", 400);
  }

  // Exchange the Are.na auth code for an access token
  const origin = new URL(c.req.url).origin;

  const tokenRes = await fetch(ARENA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: c.env.ARENA_OAUTH_CLIENT_ID,
      client_secret: c.env.ARENA_OAUTH_CLIENT_SECRET,
      code: arenaCode,
      redirect_uri: `${origin}/callback`,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    return c.text(`Failed to exchange code with Are.na: ${body}`, 502);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  // Generate an MCP authorization code mapped to the Are.na token
  const mcpCode = generateId(32);

  await store.putAuthCode(mcpCode, {
    arena_access_token: tokenData.access_token,
    client_id: flow.client_id,
    redirect_uri: flow.redirect_uri,
    code_challenge: flow.code_challenge,
    code_challenge_method: flow.code_challenge_method,
    scope: flow.scope,
  });

  // Clean up the flow state
  await store.deleteAuthFlow(arenaState);

  // Redirect back to the MCP client with the code
  const clientState = await c.env.OAUTH_KV.get(`client_state:${arenaState}`);
  if (clientState) {
    await c.env.OAUTH_KV.delete(`client_state:${arenaState}`);
  }

  const redirectUrl = new URL(flow.redirect_uri);
  redirectUrl.searchParams.set("code", mcpCode);
  if (clientState) {
    redirectUrl.searchParams.set("state", clientState);
  }

  return c.redirect(redirectUrl.toString());
});

/**
 * Token endpoint — validates the MCP auth code + PKCE code_verifier,
 * then returns the Are.na access token as the MCP access token.
 */
oauthRoutes.post("/token", async (c) => {
  const body = await c.req.parseBody();

  const grant_type = body["grant_type"] as string;
  const code = body["code"] as string;
  const code_verifier = body["code_verifier"] as string;
  const redirect_uri = body["redirect_uri"] as string;

  if (grant_type !== "authorization_code") {
    return c.json(
      {
        error: "unsupported_grant_type",
        error_description: "Only authorization_code is supported",
      },
      400,
    );
  }

  if (!code || !code_verifier) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "code and code_verifier are required",
      },
      400,
    );
  }

  const store = new OAuthStore(c.env.OAUTH_KV);
  const entry = await store.getAuthCode(code);

  if (!entry) {
    return c.json(
      {
        error: "invalid_grant",
        error_description: "Invalid or expired authorization code",
      },
      400,
    );
  }

  if (redirect_uri && redirect_uri !== entry.redirect_uri) {
    return c.json(
      { error: "invalid_grant", error_description: "redirect_uri mismatch" },
      400,
    );
  }

  const valid = await verifyPkce(
    code_verifier,
    entry.code_challenge,
    entry.code_challenge_method,
  );

  if (!valid) {
    return c.json(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      400,
    );
  }

  // Consume the authorization code (single use)
  await store.deleteAuthCode(code);

  // Return the Are.na access token directly.
  // Are.na tokens don't expire, so we omit expires_in and refresh_token.
  return c.json({
    access_token: entry.arena_access_token,
    token_type: "Bearer",
    scope: entry.scope ?? "read",
  });
});
