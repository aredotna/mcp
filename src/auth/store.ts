/**
 * KV-backed store for OAuth state: client registrations, PKCE auth flows,
 * and authorization code-to-token mappings.
 */

export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method?: "none" | "client_secret_post";
  redirect_uris: string[];
  client_name?: string;
  created_at: number;
}

export interface AuthFlowState {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  arena_state: string;
  client_state?: string;
}

export interface AuthCodeEntry {
  arena_access_token: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
}

const TTL = {
  AUTH_FLOW: 600, // 10 minutes for in-progress auth flows
  AUTH_CODE: 300, // 5 minutes for authorization codes
  CLIENT: 60 * 60 * 24 * 365, // 1 year for client registrations
} as const;

function key(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

export class OAuthStore {
  constructor(private kv: KVNamespace) {}

  async putClient(client: OAuthClient): Promise<void> {
    await this.kv.put(key("client", client.client_id), JSON.stringify(client), {
      expirationTtl: TTL.CLIENT,
    });
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    const raw = await this.kv.get(key("client", clientId));
    return raw ? (JSON.parse(raw) as OAuthClient) : null;
  }

  async putClientMetadata(client: OAuthClient, ttl: number): Promise<void> {
    await this.kv.put(
      key("cimd", client.client_id),
      JSON.stringify({
        client,
        expires_at: Date.now() + ttl * 1000,
      }),
      { expirationTtl: ttl },
    );
  }

  async getClientMetadata(clientId: string): Promise<OAuthClient | null> {
    const raw = await this.kv.get(key("cimd", clientId));
    if (!raw) return null;
    const cached = JSON.parse(raw) as {
      client: OAuthClient;
      expires_at: number;
    };
    return cached.expires_at > Date.now() ? cached.client : null;
  }

  // Pending consent and approved flows use different keys, avoiding repeated
  // writes to the same KV key when the user immediately submits the form.
  async putConsent(state: string, flow: AuthFlowState): Promise<void> {
    await this.kv.put(key("consent", state), JSON.stringify(flow), {
      expirationTtl: TTL.AUTH_FLOW,
    });
  }

  async getConsent(state: string): Promise<AuthFlowState | null> {
    const raw = await this.kv.get(key("consent", state));
    return raw ? (JSON.parse(raw) as AuthFlowState) : null;
  }

  async deleteConsent(state: string): Promise<void> {
    await this.kv.delete(key("consent", state));
  }

  async putAuthFlow(state: string, flow: AuthFlowState): Promise<void> {
    await this.kv.put(key("flow", state), JSON.stringify(flow), {
      expirationTtl: TTL.AUTH_FLOW,
    });
  }

  async getAuthFlow(state: string): Promise<AuthFlowState | null> {
    const raw = await this.kv.get(key("flow", state));
    return raw ? (JSON.parse(raw) as AuthFlowState) : null;
  }

  async deleteAuthFlow(state: string): Promise<void> {
    await this.kv.delete(key("flow", state));
  }

  async putAuthCode(code: string, entry: AuthCodeEntry): Promise<void> {
    await this.kv.put(key("code", code), JSON.stringify(entry), {
      expirationTtl: TTL.AUTH_CODE,
    });
  }

  async getAuthCode(code: string): Promise<AuthCodeEntry | null> {
    const raw = await this.kv.get(key("code", code));
    return raw ? (JSON.parse(raw) as AuthCodeEntry) : null;
  }

  async deleteAuthCode(code: string): Promise<void> {
    await this.kv.delete(key("code", code));
  }
}
