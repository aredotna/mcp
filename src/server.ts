import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGeneratedTools } from "./generated/tools";
import { registerCustomTools } from "./tools/index";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "@aredotna/mcp",
    version: "0.1.0",
  });

  registerGeneratedTools(server);
  registerCustomTools(server);

  return server;
}
