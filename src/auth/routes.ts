/** OAuth authorization for MCP clients, backed by Are.na account sign-in. */
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { OAuthStore, type AuthFlowState } from "./store";
import { generateId, secretsEqual, verifyPkce } from "./crypto";
import {
  matchesRedirectUri,
  registrationMetadata,
  resolveClient,
} from "./clients";
import { normalizeScope } from "./scopes";
import { consentPage } from "./consent";

const ARENA_AUTHORIZE_URL = "https://www.are.na/oauth/authorize";
const ARENA_TOKEN_URL = "https://api.are.na/v3/oauth/token";

interface OAuthEnv {
  OAUTH_KV: KVNamespace;
  ARENA_OAUTH_CLIENT_ID: string;
  ARENA_OAUTH_CLIENT_SECRET: string;
}

type OAuthContext = Context<{ Bindings: OAuthEnv }>;
export const oauthRoutes = new Hono<{ Bindings: OAuthEnv }>();

function origin(c: OAuthContext): string {
  return new URL(c.req.url).origin;
}

// One cookie per flow, so concurrent sign-ins in a browser stay independent.
function consentCookie(c: OAuthContext, state: string): string {
  const name = `arena_mcp_consent_${state}`;
  return new URL(c.req.url).protocol === "https:" ? `__Host-${name}` : name;
}

function browserMatches(c: OAuthContext, state: string): boolean {
  const cookie = getCookie(c, consentCookie(c, state));
  return !!cookie && secretsEqual(cookie, state);
}

function clientRedirect(
  c: OAuthContext,
  flow: AuthFlowState,
  params: Record<string, string>,
) {
  const url = new URL(flow.redirect_uri);
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value);
  url.searchParams.set("iss", origin(c));
  if (flow.client_state !== undefined)
    url.searchParams.set("state", flow.client_state);
  deleteCookie(c, consentCookie(c, flow.arena_state), {
    path: "/",
    secure: new URL(c.req.url).protocol === "https:",
  });
  return c.redirect(url.toString());
}

// Auth codes, form tokens, and access tokens must not enter shared caches.
oauthRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  c.header("Referrer-Policy", "no-referrer");
  await next();
});

function protectedResourceMetadata(c: OAuthContext) {
  return c.json({
    resource: `${origin(c)}/mcp`,
    authorization_servers: [origin(c)],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read", "write"],
    resource_name: "Are.na MCP",
    resource_documentation: "https://github.com/aredotna/mcp",
  });
}

oauthRoutes.get(
  "/.well-known/oauth-protected-resource",
  protectedResourceMetadata,
);
oauthRoutes.get(
  "/.well-known/oauth-protected-resource/mcp",
  protectedResourceMetadata,
);
oauthRoutes.get("/.well-known/oauth-authorization-server", (c) =>
  c.json({
    issuer: origin(c),
    authorization_endpoint: `${origin(c)}/authorize`,
    token_endpoint: `${origin(c)}/token`,
    registration_endpoint: `${origin(c)}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: ["read", "write"],
  }),
);

oauthRoutes.post("/register", async (c) => {
  const parsed = registrationMetadata.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json(
      {
        error: "invalid_client_metadata",
        error_description:
          "Provide valid redirect_uris and a supported client authentication method",
      },
      400,
    );
  const metadata = parsed.data;
  const client = {
    client_id: generateId(16),
    ...(metadata.token_endpoint_auth_method === "client_secret_post"
      ? { client_secret: generateId(32) }
      : {}),
    redirect_uris: metadata.redirect_uris,
    client_name: metadata.client_name,
    token_endpoint_auth_method: metadata.token_endpoint_auth_method,
    created_at: Date.now(),
  };
  await new OAuthStore(c.env.OAUTH_KV).putClient(client);
  const { created_at, ...registration } = client;
  return c.json(registration, 201);
});

oauthRoutes.get("/authorize", async (c) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    code_challenge,
    code_challenge_method,
    state,
    scope,
    resource,
  } = c.req.query();
  if (response_type !== "code")
    return c.json(
      {
        error: "unsupported_response_type",
        error_description: "Only 'code' is supported",
      },
      400,
    );
  if (!client_id || !redirect_uri || !code_challenge)
    return c.json(
      {
        error: "invalid_request",
        error_description:
          "client_id, redirect_uri, and code_challenge are required",
      },
      400,
    );
  if (
    code_challenge_method !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(code_challenge)
  )
    return c.json(
      {
        error: "invalid_request",
        error_description: "A valid S256 code challenge is required",
      },
      400,
    );
  if (resource !== undefined && resource !== `${origin(c)}/mcp`)
    return c.json({ error: "invalid_target" }, 400);
  const requestedScope = normalizeScope(scope);
  if (requestedScope === null)
    return c.json(
      {
        error: "invalid_scope",
        error_description: "Supported scopes are read and write",
      },
      400,
    );

  const store = new OAuthStore(c.env.OAUTH_KV);
  const client = await resolveClient(client_id, store);
  if (!client)
    return c.json(
      {
        error: "invalid_client",
        error_description: "Unknown or unsupported client identity",
      },
      401,
    );
  if (!matchesRedirectUri(redirect_uri, client.redirect_uris))
    return c.json(
      {
        error: "invalid_request",
        error_description: "redirect_uri not registered for this client",
      },
      400,
    );

  const arenaState = generateId(32);
  await store.putConsent(arenaState, {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    scope: requestedScope,
    arena_state: arenaState,
    client_state: state,
  });
  setCookie(c, consentCookie(c, arenaState), arenaState, {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: 600,
  });
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  );
  c.header("X-Frame-Options", "DENY");
  // Under no-referrer, browsers send `Origin: null` with the consent form.
  c.header("Referrer-Policy", "same-origin");
  return c.html(consentPage(client, arenaState, redirect_uri, requestedScope));
});

oauthRoutes.post("/authorize/consent", async (c) => {
  const body = await c.req.parseBody();
  const state = body.state;
  if (
    typeof state !== "string" ||
    !browserMatches(c, state) ||
    c.req.header("Origin") !== origin(c)
  )
    return c.json(
      {
        error: "invalid_request",
        error_description: "Invalid consent request; restart sign-in",
      },
      400,
    );
  if (body.decision !== "allow" && body.decision !== "deny")
    return c.json({ error: "invalid_request" }, 400);
  const store = new OAuthStore(c.env.OAUTH_KV);
  const flow = await store.getConsent(state);
  if (!flow)
    return c.json(
      {
        error: "invalid_request",
        error_description: "Expired or already submitted consent",
      },
      400,
    );
  if (body.decision === "deny") {
    await store.deleteConsent(state);
    return clientRedirect(c, flow, { error: "access_denied" });
  }
  await store.putAuthFlow(state, flow);
  await store.deleteConsent(state);
  const params = new URLSearchParams({
    client_id: c.env.ARENA_OAUTH_CLIENT_ID,
    redirect_uri: `${origin(c)}/callback`,
    response_type: "code",
    state,
    scope: flow.scope,
  });
  return c.redirect(`${ARENA_AUTHORIZE_URL}?${params}`);
});

const upstreamToken = z.object({
  access_token: z.string().min(1),
  scope: z.string().optional(),
});

oauthRoutes.get("/callback", async (c) => {
  const { code, state, error } = c.req.query();
  if (!state || !browserMatches(c, state))
    return c.text("Invalid authorization state; restart sign-in", 400);
  const store = new OAuthStore(c.env.OAUTH_KV);
  const flow = await store.getAuthFlow(state);
  if (!flow)
    return c.text(
      "Invalid or expired authorization state; restart sign-in",
      400,
    );
  if (error) {
    await store.deleteAuthFlow(state);
    return clientRedirect(c, flow, { error: "access_denied" });
  }
  if (!code) return c.text("Missing authorization code", 400);

  let token;
  try {
    const response = await fetch(ARENA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: c.env.ARENA_OAUTH_CLIENT_ID,
        client_secret: c.env.ARENA_OAUTH_CLIENT_SECRET,
        code,
        redirect_uri: `${origin(c)}/callback`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Upstream token exchange failed");
    }
    token = upstreamToken.parse(await response.json());
  } catch {
    await store.deleteAuthFlow(state);
    return clientRedirect(c, flow, {
      error: "server_error",
      error_description: "Could not complete Are.na sign-in; please try again",
    });
  }
  const grantedScope =
    token.scope === undefined ? flow.scope : normalizeScope(token.scope);
  if (
    !grantedScope ||
    grantedScope
      .split(" ")
      .some((scope) => !flow.scope.split(" ").includes(scope))
  ) {
    await store.deleteAuthFlow(state);
    return clientRedirect(c, flow, {
      error: "server_error",
      error_description: "Are.na returned an unexpected scope",
    });
  }
  const mcpCode = generateId(32);
  await store.putAuthCode(mcpCode, {
    arena_access_token: token.access_token,
    client_id: flow.client_id,
    redirect_uri: flow.redirect_uri,
    code_challenge: flow.code_challenge,
    code_challenge_method: flow.code_challenge_method,
    scope: grantedScope,
  });
  await store.deleteAuthFlow(state);
  return clientRedirect(c, flow, { code: mcpCode });
});

oauthRoutes.post("/token", async (c) => {
  const body = await c.req.parseBody();
  if (body.grant_type !== "authorization_code")
    return c.json(
      {
        error: "unsupported_grant_type",
        error_description: "Only authorization_code is supported",
      },
      400,
    );
  const {
    code,
    code_verifier,
    client_id,
    redirect_uri,
    client_secret,
    resource,
  } = body;
  if (
    typeof code !== "string" ||
    !code ||
    typeof code_verifier !== "string" ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(code_verifier) ||
    typeof client_id !== "string" ||
    !client_id ||
    (redirect_uri !== undefined &&
      (typeof redirect_uri !== "string" || !redirect_uri))
  )
    return c.json(
      {
        error: "invalid_request",
        error_description:
          "code, a valid code_verifier, and client_id are required",
      },
      400,
    );
  if (resource !== undefined && resource !== `${origin(c)}/mcp`)
    return c.json({ error: "invalid_target" }, 400);
  // Only the advertised methods are accepted; never ignore an attempted Basic
  // or JWT authentication and accidentally treat it as a public-client request.
  if (
    c.req.header("Authorization") ||
    body.client_assertion !== undefined ||
    body.client_assertion_type !== undefined
  )
    return c.json({ error: "invalid_client" }, 401);
  const store = new OAuthStore(c.env.OAUTH_KV);
  const client = await resolveClient(client_id, store);
  if (!client) return c.json({ error: "invalid_client" }, 401);
  // Existing DCR records predate this field, but were issued a client secret.
  const method =
    client.token_endpoint_auth_method ??
    (client.client_secret ? "client_secret_post" : "none");
  if (method === "client_secret_post") {
    if (
      typeof client_secret !== "string" ||
      !client.client_secret ||
      !secretsEqual(client_secret, client.client_secret)
    )
      return c.json({ error: "invalid_client" }, 401);
  } else if (client_secret !== undefined) {
    return c.json({ error: "invalid_client" }, 401);
  }

  // OAuth 2.1 clients may omit redirect_uri at token exchange. When supplied
  // by an OAuth 2.0 client, it must match the authorization request exactly.
  const entry = await store.getAuthCode(code);
  if (
    !entry ||
    entry.client_id !== client_id ||
    (redirect_uri !== undefined && entry.redirect_uri !== redirect_uri) ||
    !matchesRedirectUri(entry.redirect_uri, client.redirect_uris)
  )
    return c.json({ error: "invalid_grant" }, 400);
  if (
    !(await verifyPkce(
      code_verifier,
      entry.code_challenge,
      entry.code_challenge_method,
    ))
  )
    return c.json(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      400,
    );
  // KV deletion prevents sequential replay. It is not an atomic redemption
  // primitive across concurrent requests; that requires a coordinated store.
  await store.deleteAuthCode(code);
  return c.json({
    access_token: entry.arena_access_token,
    token_type: "Bearer",
    // Codes stored without a scope were issued for write access.
    scope: entry.scope ?? "write",
  });
});
