import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../transports/http";
import { OAuthStore } from "../auth/store";

const ORIGIN = "https://mcp.are.na";
const REDIRECT = "http://127.0.0.1:3000/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CHATGPT = "https://chatgpt.com/oauth/client.json";

function environment() {
  const data = new Map<string, string>();
  const kv = {
    get: vi
      .fn()
      .mockImplementation(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  };
  return {
    OAUTH_KV: kv,
    ARENA_OAUTH_CLIENT_ID: "arena-app-id",
    ARENA_OAUTH_CLIENT_SECRET: "arena-app-secret",
  };
}

type Client = { client_id: string; client_secret?: string };
let env: ReturnType<typeof environment>;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  env = environment();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function request(path: string, init?: RequestInit) {
  return app.fetch(new Request(ORIGIN + path, init), env);
}
function post(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(body),
  });
}
async function register(metadata: Record<string, unknown> = {}) {
  const response = await request("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [REDIRECT],
      client_name: "Test app",
      ...metadata,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Client;
}
async function authorize(
  client: Client,
  overrides: Record<string, string> = {},
) {
  return request(
    `/authorize?${new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      response_type: "code",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "original-client-state",
      ...overrides,
    })}`,
  );
}
async function consent(client: Client, overrides: Record<string, string> = {}) {
  const response = await authorize(client, overrides);
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
  const page = await response.text();
  const state = /name="state" value="([a-f0-9]+)"/.exec(page)![1];
  const result = await post(
    "/authorize/consent",
    { state, decision: "allow" },
    { Cookie: cookie, Origin: ORIGIN },
  );
  expect(result.status).toBe(302);
  return { state, cookie, upstream: new URL(result.headers.get("Location")!) };
}
async function issueCode(
  client: Client,
  options: { scope?: string; tokenScope?: string; redirect?: string } = {},
) {
  const flow = await consent(client, {
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(options.redirect ? { redirect_uri: options.redirect } : {}),
  });
  fetchMock.mockResolvedValueOnce(
    Response.json({
      access_token: "arena-user-token",
      ...(options.tokenScope !== undefined
        ? { scope: options.tokenScope }
        : {}),
    }),
  );
  const response = await request(
    `/callback?code=upstream-code&state=${flow.state}`,
    { headers: { Cookie: flow.cookie } },
  );
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("Location")!);
  expect(location.searchParams.get("iss")).toBe(ORIGIN);
  expect(location.searchParams.get("state")).toBe("original-client-state");
  const code = location.searchParams.get("code")!;
  expect(code).toBeTruthy();
  return { code, flow };
}
function exchange(
  client: Client,
  code: string,
  overrides: Record<string, string> = {},
) {
  return post("/token", {
    grant_type: "authorization_code",
    client_id: client.client_id,
    code,
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    ...overrides,
  });
}
function metadata(clientId = CLAUDE, overrides: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    client_name: "Published app",
    redirect_uris: [REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...overrides,
  };
}
function mockMetadata(
  body = metadata(),
  headers: Record<string, string> = { "Cache-Control": "public, max-age=300" },
) {
  fetchMock.mockResolvedValueOnce(Response.json(body, { headers }));
}

describe("OAuth scopes through authorization, callback, and token exchange", () => {
  it.each([
    [undefined, "write"],
    ["read", "read"],
    ["write", "write"],
    ["write read write", "read write"],
  ])("keeps requested scope %s consistent", async (scope, expected) => {
    const client = await register();
    const { code, flow } = await issueCode(client, { scope });
    expect(flow.upstream.searchParams.get("scope")).toBe(expected);
    const response = await exchange(client, code);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      access_token: "arena-user-token",
      token_type: "Bearer",
      scope: expected,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await exchange(client, code)).status).toBe(400);
  });

  it.each(["", "openid", "read admin", "READ", "read\twrite"])(
    "rejects unsupported scope %j before saving a flow",
    async (scope) => {
      const client = await register();
      const response = await authorize(client, { scope });
      expect(await response.json()).toMatchObject({ error: "invalid_scope" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("reports a narrower scope returned by Are.na", async () => {
    const client = await register();
    const { code } = await issueCode(client, {
      scope: "read write",
      tokenScope: "read",
    });
    expect(await (await exchange(client, code)).json()).toMatchObject({
      scope: "read",
    });
  });

  it("rejects unexpected scope escalation from upstream", async () => {
    const client = await register();
    const flow = await consent(client, { scope: "read" });
    fetchMock.mockResolvedValueOnce(
      Response.json({ access_token: "token", scope: "write" }),
    );
    const response = await request(
      `/callback?state=${flow.state}&code=upstream`,
      { headers: { Cookie: flow.cookie } },
    );
    const url = new URL(response.headers.get("Location")!);
    expect(url.searchParams.get("error")).toBe("server_error");
    expect(url.searchParams.has("code")).toBe(false);
  });

  it("reports the real write scope of legacy in-flight codes", async () => {
    const client = await register();
    await new OAuthStore(env.OAUTH_KV).putAuthCode("legacy-code", {
      arena_access_token: "legacy-token",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    });
    expect(await (await exchange(client, "legacy-code")).json()).toMatchObject({
      scope: "write",
    });
  });
});

describe("client registration and token binding", () => {
  it.each([
    { redirect_uris: [123] },
    { redirect_uris: [] },
    { redirect_uris: ["javascript:alert(1)"] },
    { redirect_uris: ["JavaScript://app.example/%0Aalert(1)"] },
    { redirect_uris: ["data:text/html,callback"] },
    { redirect_uris: ["https://app.example/callback#fragment"] },
    { redirect_uris: ["https://user:password@app.example/callback"] },
    { redirect_uris: ["https://*.example/callback"] },
    { redirect_uris: ["http://public.example/callback"] },
    { client_name: {} },
    { token_endpoint_auth_method: "client_secret_basic" },
    { grant_types: ["client_credentials"] },
    { response_types: ["token"] },
  ])("rejects malformed or unsupported metadata: %j", async (metadata) => {
    const response = await request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [REDIRECT], ...metadata }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_client_metadata",
    });
  });

  it("returns a registration error for malformed JSON", async () => {
    const response = await request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
  });

  it.each([
    "https://app.example/callback",
    "http://localhost:4321/callback",
    "http://[::1]:4321/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
  ])("supports callback %s", async (redirect) => {
    await register({ redirect_uris: [redirect] });
  });

  it("honors public DCR clients without generating a secret", async () => {
    const client = await register({ token_endpoint_auth_method: "none" });
    expect(client.client_secret).toBeUndefined();
    const { code } = await issueCode(client);
    expect(
      (await exchange(client, code, { client_secret: "unexpected" })).status,
    ).toBe(401);
    expect((await exchange(client, code)).status).toBe(200);
  });

  it("requires confidential client credentials, including legacy registrations", async () => {
    const client = await register();
    const store = new OAuthStore(env.OAUTH_KV);
    const saved = (await store.getClient(client.client_id))!;
    delete saved.token_endpoint_auth_method;
    await store.putClient(saved);
    const { code } = await issueCode(client);
    expect((await exchange({ client_id: client.client_id }, code)).status).toBe(
      401,
    );
    expect(
      (await exchange(client, code, { client_secret: "wrong" })).status,
    ).toBe(401);
    expect((await exchange(client, code)).status).toBe(200);
  });

  it("accepts OAuth 2.1 token exchange without a redundant redirect_uri", async () => {
    const client = await register({ token_endpoint_auth_method: "none" });
    const { code } = await issueCode(client);
    const response = await post("/token", {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      code_verifier: VERIFIER,
    });
    expect(response.status).toBe(200);
  });

  it("binds authorization codes to the client even when PKCE and redirect match", async () => {
    const client = await register();
    const other = await register();
    const { code } = await issueCode(client);
    expect(await (await exchange(other, code)).json()).toMatchObject({
      error: "invalid_grant",
    });
    expect((await exchange(client, code)).status).toBe(200);
  });

  it.each<Record<string, string>>([
    { client_id: "" },
    { redirect_uri: "" },
    { redirect_uri: "https://attacker.example/callback" },
    { code_verifier: "short" },
    { code_verifier: "x".repeat(43) },
    { resource: "https://another-resource.example/mcp" },
    { client_assertion: "unverified-jwt" },
  ])(
    "rejects invalid token requests without consuming the code: %j",
    async (overrides) => {
      const client = await register();
      const { code } = await issueCode(client);
      const response = await exchange(client, code, overrides);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect((await exchange(client, code)).status).toBe(200);
    },
  );

  it.each<Record<string, string>>([
    { code_challenge_method: "" },
    { code_challenge_method: "plain" },
    { code_challenge: "short" },
    { redirect_uri: "https://attacker.example" },
    { resource: "https://wrong.example" },
  ])("rejects invalid authorization parameters: %j", async (overrides) => {
    expect((await authorize(await register(), overrides)).status).toBe(400);
  });
});

describe("browser consent and callbacks", () => {
  it("shows the client and destination with escaped untrusted text", async () => {
    const client = await register({
      client_name: '<script>alert("x")</script>',
    });
    const response = await authorize(client);
    const page = await response.text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;");
    expect(page).toContain(REDIRECT);
    expect(page).toContain(client.client_id);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the browser cookie and same-origin form submission", async () => {
    const response = await authorize(await register());
    const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
    const state = /name="state" value="([a-f0-9]+)"/.exec(
      await response.text(),
    )![1];
    expect(
      (
        await post(
          "/authorize/consent",
          { state, decision: "allow" },
          { Origin: ORIGIN },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/authorize/consent",
          { state, decision: "allow" },
          { Origin: "https://evil.example", Cookie: cookie },
        )
      ).status,
    ).toBe(400);
    const cancelled = await post(
      "/authorize/consent",
      { state, decision: "deny" },
      { Origin: ORIGIN, Cookie: cookie },
    );
    const url = new URL(cancelled.headers.get("Location")!);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
    expect(url.searchParams.get("state")).toBe("original-client-state");
    expect(await new OAuthStore(env.OAUTH_KV).getConsent(state)).toBeNull();
  });

  it("requires consent and the same browser at callback", async () => {
    const client = await register();
    const response = await authorize(client);
    const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
    const state = /name="state" value="([a-f0-9]+)"/.exec(
      await response.text(),
    )![1];
    expect(
      (
        await request(`/callback?state=${state}&code=x`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(400);
    await post(
      "/authorize/consent",
      { state, decision: "allow" },
      { Cookie: cookie, Origin: ORIGIN },
    );
    expect((await request(`/callback?state=${state}&code=x`)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns issuer and original state on upstream denial", async () => {
    const flow = await consent(await register());
    const response = await request(
      `/callback?state=${flow.state}&error=access_denied`,
      { headers: { Cookie: flow.cookie } },
    );
    const url = new URL(response.headers.get("Location")!);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
    expect(url.searchParams.get("state")).toBe("original-client-state");
    expect(
      (
        await request(`/callback?state=${flow.state}&error=access_denied`, {
          headers: { Cookie: flow.cookie },
        })
      ).status,
    ).toBe(400);
  });

  it("does not expose upstream error payloads", async () => {
    const flow = await consent(await register());
    fetchMock.mockResolvedValueOnce(
      new Response("private upstream debug details", { status: 500 }),
    );
    const response = await request(`/callback?state=${flow.state}&code=x`, {
      headers: { Cookie: flow.cookie },
    });
    expect(response.headers.get("Location")).not.toContain("private");
    expect(
      new URL(response.headers.get("Location")!).searchParams.get("error"),
    ).toBe("server_error");
  });
});

describe("published client identities", () => {
  it("advertises CIMD and issuer identification", async () => {
    expect(
      await (await request("/.well-known/oauth-authorization-server")).json(),
    ).toMatchObject({
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it.each([
    CLAUDE,
    CHATGPT,
    "https://chatgpt.com/oauth/callback-123/client.json",
  ])("supports the full flow for %s", async (clientId) => {
    mockMetadata(
      metadata(
        clientId,
        clientId.includes("chatgpt.com")
          ? {
              token_endpoint_auth_method: "private_key_jwt",
              token_endpoint_auth_methods_supported: [
                "none",
                "private_key_jwt",
              ],
            }
          : {},
      ),
    );
    const client = { client_id: clientId };
    const { code } = await issueCode(client);
    expect((await exchange(client, code)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2); // document + upstream token
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
  });

  it.each([
    "https://127.0.0.1/client.json",
    "https://metadata.google.internal/client.json",
    "http://claude.ai/oauth/mcp-oauth-client-metadata",
    "https://claude.ai.evil.example/oauth/mcp-oauth-client-metadata",
    "https://claude.ai@evil.example/oauth/mcp-oauth-client-metadata",
    "https://chatgpt.com:444/oauth/client.json",
    "https://chatgpt.com/oauth/client.json?url=http://localhost",
    "https://chatgpt.com/oauth/../client.json",
    "https://chatgpt.com/oauth/client.json#fragment",
  ])(
    "rejects untrusted metadata URLs without fetching: %s",
    async (clientId) => {
      expect((await authorize({ client_id: clientId })).status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { client_id: CHATGPT },
    { client_name: undefined },
    { redirect_uris: [123] },
    { redirect_uris: ["javascript:alert(1)"] },
    { token_endpoint_auth_method: "private_key_jwt" },
    { token_endpoint_auth_methods_supported: ["private_key_jwt"] },
  ])(
    "rejects invalid or unsupported published metadata: %j",
    async (overrides) => {
      mockMetadata(metadata(CLAUDE, overrides));
      expect((await authorize({ client_id: CLAUDE })).status).toBe(401);
    },
  );

  it("does not follow document redirects", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/private" },
      }),
    );
    expect((await authorize({ client_id: CLAUDE })).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it.each([
    new Response("not json", {
      headers: { "Content-Type": "application/json" },
    }),
    new Response("x".repeat(32769), {
      headers: { "Content-Type": "application/json" },
    }),
    new Response("<html>not metadata</html>", {
      headers: { "Content-Type": "text/html" },
    }),
  ])("rejects unreadable documents", async (response) => {
    fetchMock.mockResolvedValueOnce(response);
    expect((await authorize({ client_id: CLAUDE })).status).toBe(401);
  });

  it("fails closed on a timed-out metadata fetch", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException("timeout", "TimeoutError"),
    );
    expect((await authorize({ client_id: CLAUDE })).status).toBe(401);
  });

  it("refreshes expired metadata and honors removed redirect URIs", async () => {
    vi.useFakeTimers();
    mockMetadata();
    expect((await authorize({ client_id: CLAUDE })).status).toBe(200);
    vi.advanceTimersByTime(300001);
    mockMetadata(
      metadata(CLAUDE, { redirect_uris: ["https://claude.ai/new-callback"] }),
    );
    expect((await authorize({ client_id: CLAUDE })).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "no-store",
    "no-cache, max-age=300",
    "private, max-age=300",
    "max-age=30",
  ])("does not cache %s", async (control) => {
    mockMetadata(metadata(), { "Cache-Control": control });
    mockMetadata(metadata(), { "Cache-Control": control });
    await authorize({ client_id: CLAUDE });
    await authorize({ client_id: CLAUDE });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
