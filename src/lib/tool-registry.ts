import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
  type CallToolResult,
  type ServerRequest,
  type ServerNotification,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { zodToToolJsonSchema } from "./portable-json-schema";
import { errorResult } from "./tool-helpers";

export type OutputSchema = NonNullable<Tool["outputSchema"]>;
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// The low-level MCP API lets us publish the original JSON Schemas without
// lossy conversion through Zod. Input parsing remains the existing Zod contract.
export class ToolRegistry {
  private tools = new Map<
    string,
    {
      definition: Tool;
      call: (args: unknown, extra: Extra) => Promise<CallToolResult>;
    }
  >();

  registerTool<Shape extends z.ZodRawShape>(
    name: string,
    config: {
      description: string;
      inputSchema: Shape;
      outputSchema: OutputSchema;
    },
    handler: (
      args: z.infer<z.ZodObject<Shape>>,
      extra: Extra,
    ) => Promise<CallToolResult>,
  ): void {
    if (this.tools.has(name)) throw new Error(`Duplicate tool: ${name}`);
    const input = z.object(config.inputSchema);
    const inputSchema = zodToToolJsonSchema(input);
    // Compile lazily: each HTTP request creates a server, but usually calls only
    // one tool. No eval/code generation is used in the Workers validator.
    let validate:
      | ReturnType<CfWorkerJsonSchemaValidator["getValidator"]>
      | undefined;
    this.tools.set(name, {
      definition: {
        name,
        description: config.description,
        inputSchema: { ...inputSchema, type: "object" },
        outputSchema: config.outputSchema,
      },
      call: async (args, extra) => {
        const parsed = input.safeParse(args ?? {});
        if (!parsed.success)
          return errorResult(
            `Invalid arguments for ${name}: ${parsed.error.message}`,
          );
        try {
          const result = await handler(parsed.data, extra);
          if (!result.isError) {
            validate ??= new CfWorkerJsonSchemaValidator().getValidator(
              config.outputSchema,
            );
            const checked = validate(result.structuredContent);
            if (!checked.valid)
              return errorResult(
                `Output validation failed for ${name}; the API operation may already have completed. Do not automatically retry writes. ${checked.errorMessage}`,
              );
          }
          return result;
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    });
  }

  install(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...this.tools.values()].map(({ definition }) => definition),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const tool = this.tools.get(request.params.name);
      if (!tool)
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown tool: ${request.params.name}`,
        );
      return tool.call(request.params.arguments, extra);
    });
  }
}
