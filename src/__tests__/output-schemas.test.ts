import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../server";
import { outputSchemas } from "../generated/output-schemas";
import { textBlock } from "./fixtures";

const provider = new CfWorkerJsonSchemaValidator();

describe("published output contracts", () => {
  const server = createMcpServer();
  // Use the default SDK client validator, independently of the server validator.
  const client = new Client({ name: "output-contract-test", version: "1" });
  let tools: Tool[];

  beforeAll(async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const send = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, options) =>
      send(message, {
        ...options,
        authInfo: {
          token: "test-token",
          clientId: "test",
          scopes: ["read", "write"],
        },
      });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    tools = (await client.listTools()).tools;
  });
  afterAll(async () => {
    await client.close();
    await server.close();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("publishes usable schemas for all 52 tools", () => {
    expect(tools).toHaveLength(52);
    for (const tool of tools) {
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(
        /"type":\[/,
      );
      expect(JSON.stringify(tool.outputSchema), tool.name).not.toMatch(
        /"type":\[/,
      );
      expect(tool.outputSchema?.required).toEqual(["result"]);
      const validate = provider.getValidator(tool.outputSchema!);
      expect(validate({}).valid, tool.name).toBe(false);
      expect(validate({ result: "not an API response" }).valid, tool.name).toBe(
        false,
      );
    }
  });

  it("returns the same validated payload in text and structured content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(textBlock)),
    );
    const response = await client.callTool({
      name: "getBlock",
      arguments: { id: 1 },
    });
    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual({ result: textBlock });
    expect(response.content).toEqual([
      { type: "text", text: JSON.stringify({ result: textBlock }, null, 2) },
    ]);
  });

  it("rejects malformed upstream payloads instead of reporting success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...textBlock, id: "wrong" })),
    );
    const response = await client.callTool({
      name: "getBlock",
      arguments: { id: 1 },
    });
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Output validation failed for getBlock"),
      },
    ]);
  });

  it("preserves API errors without validating against the success schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Forbidden", code: 403 }, { status: 403 }),
      ),
    );
    const response = await client.callTool({
      name: "getBlock",
      arguments: { id: 1 },
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      { type: "text", text: JSON.stringify({ error: "Forbidden", code: 403 }) },
    ]);
  });

  it("uses an explicit null result for empty successes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const response = await client.callTool({
      name: "deleteComment",
      arguments: { id: 1 },
    });
    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual({ result: null });
  });

  it("validates current custom-tool outputs including skipped types and omitted optional fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: 2, type: "User" }] })),
    );
    const response = await client.callTool({
      name: "searchAndConnect",
      arguments: { query: "test", target_channel_id: "research" },
    });
    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual({
      result: {
        query: "test",
        target_channel: "research",
        found: 1,
        connected: 0,
        skipped: [{ id: 2, type: "User" }],
        items: [],
      },
    });
  });

  it("retains unions, nullability, formats, dictionaries and additive fields", () => {
    const validate = provider.getValidator(outputSchemas.getBlock);
    expect(
      validate({ result: { ...textBlock, future_field: "preserved" } }).valid,
    ).toBe(true);
    expect(validate({ result: { ...textBlock, type: "Image" } }).valid).toBe(
      false,
    );
    expect(
      validate({ result: { ...textBlock, created_at: "yesterday" } }).valid,
    ).toBe(false);
    expect(
      validate({ result: { ...textBlock, metadata: { nested: {} } } }).valid,
    ).toBe(false);
    expect(
      validate({
        result: {
          ...textBlock,
          metadata: Object.fromEntries(
            Array.from({ length: 51 }, (_, i) => [`key_${i}`, i]),
          ),
        },
      }).valid,
    ).toBe(false);
    expect(
      validate({
        result: {
          ...textBlock,
          _links: {
            self: { href: "https://example.com" },
            next: { href: 123 },
          },
        },
      }).valid,
    ).toBe(false);
  });

  it("exposes real response fields instead of an untyped result", () => {
    const schema = outputSchemas.getBlock;
    expect(schema.properties.result).toEqual({ $ref: "#/$defs/Block" });
    expect(schema.$defs.Block.oneOf).toHaveLength(6);
    expect(schema.$defs.BaseBlockProperties.required).toContain("id");
    expect(schema.$defs.BaseBlockProperties.properties.id.type).toBe("integer");
  });
});
