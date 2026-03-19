import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../server";

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

  // For stdio, we inject authInfo into every request via a middleware-like approach.
  // The SDK's stdio transport doesn't natively support per-request auth,
  // so we override the server's request handler to inject it.
  const originalConnect = server.connect.bind(server);
  server.connect = async (t) => {
    await originalConnect(t);

    // Wrap the transport's onmessage to inject authInfo
    const originalOnMessage = t.onmessage;
    if (originalOnMessage) {
      t.onmessage = (message, extra) => {
        originalOnMessage(message, {
          ...extra,
          authInfo: {
            token,
            clientId: "stdio",
            scopes: ["read", "write"],
          },
        });
      };
    }
  };

  await server.connect(transport);

  console.error("Arena MCP Server running on stdio");
  console.error("Press Ctrl+C to exit");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
