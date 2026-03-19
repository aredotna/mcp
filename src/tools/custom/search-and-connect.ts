import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createArenaClient } from "../../client";

/**
 * Composite tool: searches Are.na and connects matching results to a channel.
 */
export function registerSearchAndConnect(server: McpServer): void {
  server.tool(
    "searchAndConnect",
    "Search Are.na and connect matching results to a target channel",
    {
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
    async (args, extra) => {
      const token = extra.authInfo?.token;
      if (!token) {
        return {
          content: [{ type: "text" as const, text: "Authentication required" }],
        };
      }

      const client = createArenaClient(token);
      const maxResults = (args.max_results as number | undefined) ?? 5;

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

      if (searchError) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(searchError) },
          ],
        };
      }

      const items = (searchData as { data?: Array<{ id: number; type?: string }> })?.data ?? [];
      const connected: Array<{ id: number; type: string }> = [];
      const errors: string[] = [];

      for (const item of items) {
        const connectableType =
          item.type === "Channel" ? "Channel" : "Block";

        const { error: connectError } = await client.POST(
          "/v3/connections",
          {
            body: {
              connectable_id: item.id,
              connectable_type: connectableType as "Block" | "Channel",
              channel_ids: [args.target_channel_id],
            },
          },
        );

        if (connectError) {
          errors.push(
            `Failed to connect ${connectableType} ${item.id}: ${JSON.stringify(connectError)}`,
          );
        } else {
          connected.push({ id: item.id, type: connectableType });
        }
      }

      const summary = {
        query: args.query,
        target_channel: args.target_channel_id,
        found: items.length,
        connected: connected.length,
        errors: errors.length > 0 ? errors : undefined,
        items: connected,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    },
  );
}
