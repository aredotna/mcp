import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchAndConnect } from "./custom/search-and-connect";

export function registerCustomTools(server: McpServer): void {
  registerSearchAndConnect(server);
}
