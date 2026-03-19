import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpServer } from "../server";

function injectAuthInfo(transport: StdioServerTransport, authInfo: AuthInfo) {
  const t = transport as Transport;
  const original = t.onmessage;
  if (!original) return;
  t.onmessage = (message, extra) => {
    original(message, { ...extra, authInfo });
  };
}

async function main() {
  const token = process.env["ARENA_ACCESS_TOKEN"];
  if (!token) {
    console.error(
      "ARENA_ACCESS_TOKEN environment variable is required for stdio transport",
    );
    process.exit(1);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  injectAuthInfo(transport, {
    token,
    clientId: "stdio",
    scopes: [],
  });

  console.error("Arena MCP Server running on stdio");
  console.error("Press Ctrl+C to exit");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
