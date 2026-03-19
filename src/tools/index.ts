import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchAndConnect } from "./custom/search-and-connect";
import { registerChannelDigest } from "./custom/channel-digest";

export function registerCustomTools(server: McpServer): void {
  registerSearchAndConnect(server);
  registerChannelDigest(server);
}
