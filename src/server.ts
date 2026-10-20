import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { ToolRegistry } from "./lib/tool-registry";
import { registerGeneratedTools } from "./generated/tools";
import { registerCustomTools } from "./tools/index";

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "@aredotna/mcp",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    },
  );

  const tools = new ToolRegistry();
  registerGeneratedTools(tools);
  registerCustomTools(tools);
  tools.install(server);

  return server;
}
