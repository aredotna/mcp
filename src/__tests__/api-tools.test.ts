import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../transports/http";
import spec from "../generated/openapi.json";

afterEach(() => vi.unstubAllGlobals());

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await app.request("http://localhost/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  const event = body.split("\n").find((line) => line.startsWith("data: "));
  const message = JSON.parse(event ? event.slice(6) : body);
  expect(message.error).toBeUndefined();
  return message.result;
}

function mockApi(responses: unknown[]) {
  const fetch = vi.fn(async (_request: Request) => {
    const response = responses.shift();
    return response instanceof Response ? response : Response.json(response);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("current Are.na API tools", () => {
  it("exposes every supported API operation plus the custom tools", async () => {
    const excluded = new Set([
      "createOAuthToken",
      "getOpenapiSpec",
      "getOpenapiSpecJson",
      "getPing",
    ]);
    const operations = Object.values(spec.paths).flatMap((methods) =>
      Object.values(methods).flatMap((operation) =>
        "operationId" in operation && !excluded.has(operation.operationId)
          ? [operation.operationId]
          : [],
      ),
    );
    const result = await rpc("tools/list");
    expect(
      result.tools.map((tool: { name: string }) => tool.name).sort(),
    ).toEqual([...operations, "searchAndConnect", "channelDigest"].sort());
  });

  it("connects v3 search results using type and skips non-connectable entities", async () => {
    const fetch = mockApi([
      {
        data: [
          { id: 1, type: "Image" },
          { id: 2, type: "Channel" },
          { id: 3, type: "User" },
        ],
      },
      { data: [] },
      { data: [] },
    ]);
    const result = await rpc("tools/call", {
      name: "searchAndConnect",
      arguments: { query: "architecture", target_channel_id: "research" },
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      found: 3,
      connected: 2,
      skipped: [{ id: 3, type: "User" }],
      items: [
        { id: 1, type: "Block" },
        { id: 2, type: "Channel" },
      ],
    });
    const requests = fetch.mock.calls;
    expect(await requests[1][0].json()).toEqual({
      connectable_id: 1,
      connectable_type: "Block",
      channel_ids: ["research"],
    });
    expect(await requests[2][0].json()).toEqual({
      connectable_id: 2,
      connectable_type: "Channel",
      channel_ids: ["research"],
    });
    expect(requests[1][0].headers.get("Authorization")).toBe(
      "Bearer test-token",
    );
  });

  it("summarizes current description, entity types, and connection activity", async () => {
    mockApi([
      {
        id: 10,
        title: "Research",
        slug: "research",
        visibility: "closed",
        description: {
          plain: "Plain description",
          markdown: "Plain **description**",
          html: "<p>Plain <b>description</b></p>",
        },
        created_at: "2026-01-01",
        updated_at: "2026-10-20",
        owner: { slug: "studio", name: "Studio", type: "Group" },
        collaborators: [
          { slug: "collaborator", name: "Collaborator", type: "User" },
        ],
        counts: { blocks: 2, channels: 1, contents: 3, collaborators: 1 },
      },
      {
        data: [
          {
            id: 1,
            type: "Image",
            title: "Photo",
            created_at: "2026-01-01",
            user: { slug: "author" },
            connection: {
              connected_at: "2026-10-20",
              connected_by: { slug: "collector" },
            },
          },
          {
            id: 2,
            type: "Channel",
            title: "Related",
            created_at: "2026-01-01",
            connection: { connected_at: "2026-10-19", connected_by: null },
          },
        ],
      },
    ]);
    const result = await rpc("tools/call", {
      name: "channelDigest",
      arguments: { channel_id: "research", sample_size: 2 },
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      channel: { description: "Plain description" },
      owner: { type: "Group" },
      collaborators: [{ type: "User" }],
      type_breakdown: {
        Image: 1,
        Channel: 1,
        note: "Based on 2 most recent items out of 3 total",
      },
      active_contributors: ["collector"],
      recent_items: [
        { id: 1, type: "Image", added: "2026-10-20", added_by: "collector" },
        { id: 2, type: "Channel", added: "2026-10-19" },
      ],
    });
  });

  it("forwards structured destinations, cover URLs, and scalar metadata", async () => {
    const fetch = mockApi([{ id: 1, type: "Link" }]);
    const args = {
      value: "https://example.com",
      cover_url: "https://example.com/cover.jpg",
      metadata: { source: "research", score: 0.5, reviewed: true },
      channels: [
        { id: "research", position: 1, metadata: { section: "intro" } },
      ],
    };
    const result = await rpc("tools/call", {
      name: "createBlock",
      arguments: args,
    });
    expect(result.isError).toBeUndefined();
    const request = fetch.mock.calls[0][0];
    expect(await request.json()).toEqual(args);
  });

  it("preserves null metadata deletions", async () => {
    const fetch = mockApi([{ id: 1 }]);
    const result = await rpc("tools/call", {
      name: "updateBlock",
      arguments: { id: 1, metadata: { status: null } },
    });
    expect(result.isError).toBeUndefined();
    const request = fetch.mock.calls[0][0];
    expect(await request.json()).toEqual({ metadata: { status: null } });
  });

  it.each([
    ["getChannelContents", { id: "research", per: 101 }],
    ["getChannelContents", { id: "research", page: 0 }],
    ["updateBlock", { id: 1, metadata: { nested: { unsupported: true } } }],
    ["updateBlock", { id: 1, metadata: { too_long: "a".repeat(2001) } }],
  ])(
    "rejects invalid %s inputs before requesting the API",
    async (name, args) => {
      const fetch = mockApi([]);
      const result = await rpc("tools/call", { name, arguments: args });
      expect(result.isError).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
