import { describe, it, expect } from "vitest";
import app from "../transports/http";

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
    const req = makeRequest("POST", "/mcp", {}, {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
      id: 1,
    });
    const env = {};
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 for unknown routes", async () => {
    const req = makeRequest("GET", "/register");
    const res = await app.fetch(req, {});
    expect(res.status).toBe(404);
  });

  it("returns 404 for removed OAuth endpoints", async () => {
    for (const path of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/authorize",
      "/token",
    ]) {
      const req = makeRequest("GET", path);
      const res = await app.fetch(req, {});
      expect(res.status).toBe(404);
    }
  });
});
