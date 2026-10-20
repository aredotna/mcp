import type { ToolRegistry } from "../lib/tool-registry";
import { registerSearchAndConnect } from "./custom/search-and-connect";
import { registerChannelDigest } from "./custom/channel-digest";

export function registerCustomTools(server: ToolRegistry): void {
  registerSearchAndConnect(server);
  registerChannelDigest(server);
}
