import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../transports/http";

// Minimal KV mock that stores values in a Map
function createKVMock(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    OAUTH_KV: createKVMock(),
    ARENA_OAUTH_CLIENT_ID: "test-arena-client-id",
    ARENA_OAUTH_CLIENT_SECRET: "test-arena-client-secret",
    ...overrides,
  };
}

function makeRequest(
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Request {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method, headers: headers ?? {} };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  return new Request(url, init);
}

describe("HTTP transport auth", () => {
  it("rejects requests without a bearer token with 401", async () => {
    const req = makeRequest(
      "POST",
      "/mcp",
      {},
      {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
        id: 1,
      },
    );
    const res = await app.fetch(req, makeEnv());
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 for unknown routes", async () => {
    const req = makeRequest("GET", "/nonexistent");
    const res = await app.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });
});

describe("OAuth metadata", () => {
  it("returns authorization server metadata", async () => {
    const req = makeRequest("GET", "/.well-known/oauth-authorization-server");
    const res = await app.fetch(req, makeEnv());
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.issuer).toBe("http://localhost");
    expect(data.authorization_endpoint).toBe("http://localhost/authorize");
    expect(data.token_endpoint).toBe("http://localhost/token");
    expect(data.registration_endpoint).toBe("http://localhost/register");
    expect(data.response_types_supported).toEqual(["code"]);
    expect(data.grant_types_supported).toEqual(["authorization_code"]);
    expect(data.code_challenge_methods_supported).toEqual(["S256"]);
  });
});

describe("Dynamic Client Registration", () => {
  it("registers a client with valid redirect_uris", async () => {
    const req = makeRequest(
      "POST",
      "/register",
      {},
      {
        redirect_uris: ["http://localhost:3000/callback"],
        client_name: "Test Client",
      },
    );
    const env = makeEnv();
    const res = await app.fetch(req, env);
    expect(res.status).toBe(201);

    const data = (await res.json()) as {
      client_id: string;
      client_secret: string;
      redirect_uris: string[];
      client_name: string;
    };
    expect(data.client_id).toBeTruthy();
    expect(data.client_secret).toBeTruthy();
    expect(data.redirect_uris).toEqual(["http://localhost:3000/callback"]);
    expect(data.client_name).toBe("Test Client");
  });

  it("rejects registration without redirect_uris", async () => {
    const req = makeRequest("POST", "/register", {}, { client_name: "Bad" });
    const res = await app.fetch(req, makeEnv());
    expect(res.status).toBe(400);

    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("invalid_client_metadata");
  });
});

describe("Authorization endpoint", () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(async () => {
    env = makeEnv();
    // Pre-register a client
    const regReq = makeRequest(
      "POST",
      "/register",
      {},
      {
        redirect_uris: ["http://localhost:3000/callback"],
      },
    );
    await app.fetch(regReq, env);
  });

  async function getRegisteredClientId(): Promise<string> {
    const kv = env.OAUTH_KV as unknown as { get: ReturnType<typeof vi.fn> };
    const calls = kv.get.mock.calls;
    // Find the client_id from the KV put calls
    const putCalls = (
      env.OAUTH_KV as unknown as { put: ReturnType<typeof vi.fn> }
    ).put.mock.calls;
    for (const call of putCalls) {
      if ((call[0] as string).startsWith("client:")) {
        const data = JSON.parse(call[1] as string);
        return data.client_id as string;
      }
    }
    throw new Error("No client registered");
  }

  it("rejects unsupported response_type", async () => {
    const clientId = await getRegisteredClientId();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://localhost:3000/callback",
      response_type: "token",
      code_challenge: "abc",
      code_challenge_method: "S256",
    });
    const req = makeRequest("GET", `/authorize?${params}`);
    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("unsupported_response_type");
  });

  it("rejects unknown client_id", async () => {
    const params = new URLSearchParams({
      client_id: "nonexistent",
      redirect_uri: "http://localhost:3000/callback",
      response_type: "code",
      code_challenge: "abc",
      code_challenge_method: "S256",
    });
    const req = makeRequest("GET", `/authorize?${params}`);
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("redirects to Are.na OAuth on valid authorize request", async () => {
    const clientId = await getRegisteredClientId();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://localhost:3000/callback",
      response_type: "code",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      state: "client-state-123",
    });
    const req = makeRequest("GET", `/authorize?${params}`);
    const res = await app.fetch(req, env);
    expect(res.status).toBe(302);

    const location = res.headers.get("Location")!;
    expect(location).toContain("www.are.na/oauth/authorize");
    expect(location).toContain("client_id=test-arena-client-id");
    expect(location).toContain("response_type=code");
  });
});

describe("Token endpoint", () => {
  it("rejects unsupported grant_type", async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      code: "abc",
      code_verifier: "xyz",
    });
    const req = new Request("http://localhost/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const res = await app.fetch(req, makeEnv());
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("unsupported_grant_type");
  });

  it("rejects invalid authorization code", async () => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: "invalid-code",
      code_verifier: "xyz",
    });
    const req = new Request("http://localhost/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const res = await app.fetch(req, makeEnv());
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("invalid_grant");
  });
});
