import type { Context } from "hono";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientInformationFullSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

const ARENA_AUTHORIZE_URL = "https://www.are.na/oauth/authorize";
const ARENA_TOKEN_URL = "https://api.are.na/v3/oauth/token";
const ARENA_ME_URL = "https://api.are.na/v3/me";

export interface ArenaOAuthConfig {
  clientId: string;
  clientSecret: string;
  kvStore: KVNamespace;
}

/**
 * OAuthServerProvider that proxies authentication to Are.na's OAuth endpoints.
 * Uses Hono Context (not Express Response) for the authorize redirect.
 *
 * Adapted from @hono/mcp's ProxyOAuthServerProvider for Are.na-specific use.
 */
export class ArenaOAuthProvider implements OAuthServerProvider {
  private config: ArenaOAuthConfig;

  skipLocalPkceValidation = true;

  constructor(config: ArenaOAuthConfig) {
    this.config = config;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    const kv = this.config.kvStore;

    return {
      async getClient(
        clientId: string,
      ): Promise<OAuthClientInformationFull | undefined> {
        const stored = await kv.get(`client:${clientId}`, "text");
        if (!stored) return undefined;
        return OAuthClientInformationFullSchema.parse(JSON.parse(stored));
      },

      async registerClient(
        client: OAuthClientInformationFull,
      ): Promise<OAuthClientInformationFull> {
        const clientId =
          client.client_id || crypto.randomUUID();
        const registered = { ...client, client_id: clientId };
        await kv.put(
          `client:${clientId}`,
          JSON.stringify(registered),
          { expirationTtl: 60 * 60 * 24 * 30 }, // 30 days
        );
        return OAuthClientInformationFullSchema.parse(registered);
      },
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const url = new URL(ARENA_AUTHORIZE_URL);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", params.redirectUri);

    if (params.codeChallenge) {
      url.searchParams.set("code_challenge", params.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    if (params.state) url.searchParams.set("state", params.state);
    if (params.scopes?.length) {
      url.searchParams.set("scope", params.scopes.join(" "));
    }

    // The authorize method signature expects Express Response in the SDK,
    // but we override handleAuthorize in the Hono router to redirect via Context.
    // This method won't be called directly; see http.ts for the Hono redirect.
    Object.assign(res, { _redirectUrl: url.toString() });
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    _authorizationCode: string,
  ): Promise<string> {
    return "";
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: authorizationCode,
    });

    if (codeVerifier) params.set("code_verifier", codeVerifier);
    if (redirectUri) params.set("redirect_uri", redirectUri);

    const response = await fetch(ARENA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    return OAuthTokensSchema.parse(data);
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });

    if (scopes?.length) params.set("scope", scopes.join(" "));

    const response = await fetch(ARENA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    return OAuthTokensSchema.parse(data);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const response = await fetch(ARENA_ME_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Invalid access token (${response.status})`);
    }

    const user = (await response.json()) as { id: number; slug: string };

    return {
      token,
      clientId: String(user.id),
      scopes: ["read", "write"],
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    _request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    // Are.na tokens don't expire and there's no revocation endpoint
  }
}
