import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  withArenaClient,
  textResult,
  errorResult,
} from "../../lib/tool-helpers";

interface Block {
  id: number;
  class?: string;
  title?: string | null;
  created_at?: string;
  updated_at?: string;
  user?: { slug?: string } | null;
  connection?: { created_at?: string; user?: { slug?: string } } | null;
}

interface ChannelMeta {
  id: number;
  title: string;
  slug: string;
  visibility: string;
  description?: { text?: string } | null;
  created_at: string;
  updated_at: string;
  owner: { slug?: string; name?: string; class?: string };
  counts: { blocks: number; channels: number; contents: number; collaborators: number };
  collaborators?: Array<{ slug?: string; name?: string; class?: string }>;
}

interface PaginationMeta {
  current_page: number;
  total_pages: number;
  total_count: number;
  has_more_pages: boolean;
}

export function registerChannelDigest(server: McpServer): void {
  server.registerTool(
    "channelDigest",
    {
      description:
        "Get a structured summary of an Are.na channel including metadata, type breakdown, collaborators, and recent activity. Samples content rather than fetching everything, so it works efficiently on large channels.",
      inputSchema: {
        channel_id: z
          .string()
          .describe("Channel ID or slug"),
        sample_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of recent items to sample for type breakdown (default 100, max 100)"),
      },
    },
    async (args, extra) => {
      return withArenaClient(extra, async (client) => {
        const { data: channel, error: channelError } = await client.GET(
          "/v3/channels/{id}",
          { params: { path: { id: args.channel_id } } } as any,
        );

        if (channelError) return errorResult(channelError);

        const meta = channel as unknown as ChannelMeta;
        const sampleSize = args.sample_size ?? 100;

        const { data: contentsData, error: contentsError } = await client.GET(
          "/v3/channels/{id}/contents",
          {
            params: {
              path: { id: args.channel_id },
              query: { per: sampleSize, sort: "created_at_desc" },
            },
          } as any,
        );

        if (contentsError) return errorResult(contentsError);

        const contents = contentsData as unknown as {
          data?: Block[];
          meta?: PaginationMeta;
        };
        const items = contents?.data ?? [];

        const typeCounts: Record<string, number> = {};
        const contributors = new Set<string>();

        for (const item of items) {
          const cls = item.class ?? "Unknown";
          typeCounts[cls] = (typeCounts[cls] ?? 0) + 1;

          const who =
            item.connection?.user?.slug ?? item.user?.slug;
          if (who) contributors.add(who);
        }

        const recentItems = items.slice(0, 5).map((item) => ({
          id: item.id,
          type: item.class,
          title: item.title ?? undefined,
          added: item.connection?.created_at ?? item.created_at,
          added_by: item.connection?.user?.slug ?? item.user?.slug,
        }));

        const sampled = items.length;
        const total = meta.counts.contents;
        const isSampled = total > sampled;

        return textResult({
          channel: {
            id: meta.id,
            title: meta.title,
            slug: meta.slug,
            visibility: meta.visibility,
            description: meta.description?.text ?? null,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
          },
          owner: {
            slug: meta.owner.slug,
            name: meta.owner.name,
            type: meta.owner.class,
          },
          counts: meta.counts,
          collaborators: meta.collaborators?.map((c) => ({
            slug: c.slug,
            name: c.name,
            type: c.class,
          })),
          type_breakdown: {
            ...(isSampled
              ? { note: `Based on ${sampled} most recent items out of ${total} total` }
              : {}),
            ...typeCounts,
          },
          active_contributors: [...contributors],
          recent_items: recentItems,
        });
      }).catch((err) => errorResult(err.message));
    },
  );
}
