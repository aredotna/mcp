import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  withArenaClient,
  textResult,
  errorResult,
} from "../../lib/tool-helpers";

const CONNECTABLE_TYPES = new Set([
  "Text",
  "Image",
  "Link",
  "Attachment",
  "Embed",
  "Channel",
]);

export function registerSearchAndConnect(server: McpServer): void {
  server.registerTool(
    "searchAndConnect",
    {
      description:
        "Search Are.na and connect matching results to a target channel",
      inputSchema: {
        query: z.string().describe("Search query"),
        target_channel_id: z
          .string()
          .describe("Channel ID or slug to connect results to"),
        type: z
          .enum([
            "All",
            "Text",
            "Image",
            "Link",
            "Attachment",
            "Embed",
            "Channel",
            "Block",
          ])
          .optional()
          .describe("Filter by content type"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Maximum number of results to connect (default 5)"),
      },
    },
    async (args, extra) => {
      return withArenaClient(extra, async (client) => {
        const maxResults = args.max_results ?? 5;

        const { data: searchData, error: searchError } = await client.GET(
          "/v3/search",
          {
            params: {
              query: {
                query: args.query,
                ...(args.type ? { type: [args.type] } : {}),
                per: maxResults,
              },
            },
          },
        );

        if (searchError) return errorResult(searchError);

        const items =
          (searchData as { data?: Array<{ id: number; class?: string }> })
            ?.data ?? [];

        const connected: Array<{ id: number; type: string }> = [];
        const skipped: Array<{ id: number; class?: string }> = [];
        const errors: string[] = [];

        for (const item of items) {
          if (!item.class || !CONNECTABLE_TYPES.has(item.class)) {
            skipped.push({ id: item.id, class: item.class });
            continue;
          }

          const connectableType =
            item.class === "Channel" ? "Channel" : "Block";

          const { error: connectError } = await client.POST("/v3/connections", {
            body: {
              connectable_id: item.id,
              connectable_type: connectableType as "Block" | "Channel",
              channel_ids: [args.target_channel_id],
            },
          });

          if (connectError) {
            errors.push(
              `Failed to connect ${connectableType} ${item.id}: ${JSON.stringify(connectError)}`,
            );
          } else {
            connected.push({ id: item.id, type: connectableType });
          }
        }

        return textResult({
          query: args.query,
          target_channel: args.target_channel_id,
          found: items.length,
          connected: connected.length,
          skipped: skipped.length > 0 ? skipped : undefined,
          errors: errors.length > 0 ? errors : undefined,
          items: connected,
        });
      }).catch((err) => errorResult(err.message));
    },
  );
}
