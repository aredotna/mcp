/**
 * KV-backed store for OAuth state: client registrations, PKCE auth flows,
 * and authorization code-to-token mappings.
 */

export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  created_at: number;
}

export interface AuthFlowState {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
  arena_state: string;
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
