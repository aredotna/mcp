import { channelDigestOutput } from "./output-schemas";
import { z } from "zod";
import type { ToolRegistry } from "../../lib/tool-registry";
import {
  withArenaClient,
  successResult,
  errorResult,
} from "../../lib/tool-helpers";

export function registerChannelDigest(server: ToolRegistry): void {
  server.registerTool(
    "channelDigest",
    {
      description:
        "Get a structured summary of an Are.na channel including metadata, type breakdown, collaborators, and recent activity. Samples content rather than fetching everything, so it works efficiently on large channels.",
      outputSchema: channelDigestOutput,
      inputSchema: {
        channel_id: z.string().describe("Channel ID or slug"),
        sample_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Number of recent items to sample for type breakdown (default 100, max 100)",
          ),
      },
    },
    async (args, extra) => {
      return withArenaClient(extra, async (client) => {
        const { data: channel, error: channelError } = await client.GET(
          "/v3/channels/{id}",
          { params: { path: { id: args.channel_id } } },
        );

        if (channelError) return errorResult(channelError);

        const meta = channel!;
        const sampleSize = args.sample_size ?? 100;

        const { data: contentsData, error: contentsError } = await client.GET(
          "/v3/channels/{id}/contents",
          {
            params: {
              path: { id: args.channel_id },
              query: { per: sampleSize, sort: "created_at_desc" },
            },
          },
        );

        if (contentsError) return errorResult(contentsError);

        const items = contentsData?.data ?? [];

        const typeCounts: Record<string, number> = {};
        const contributors = new Set<string>();

        for (const item of items) {
          const type = item.type;
          typeCounts[type] = (typeCounts[type] ?? 0) + 1;

          const who = item.connection?.connected_by?.slug;
          if (who) contributors.add(who);
        }

        const recentItems = items.slice(0, 5).map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title ?? undefined,
          added: item.connection?.connected_at ?? item.created_at,
          added_by: item.connection?.connected_by?.slug,
        }));

        const sampled = items.length;
        const total = meta.counts.contents;
        const isSampled = total > sampled;

        return successResult({
          channel: {
            id: meta.id,
            title: meta.title,
            slug: meta.slug,
            visibility: meta.visibility,
            description: meta.description?.plain ?? null,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
          },
          owner: {
            slug: meta.owner.slug,
            name: meta.owner.name,
            type: meta.owner.type,
          },
          counts: meta.counts,
          collaborators: meta.collaborators?.map((c) => ({
            slug: c.slug,
            name: c.name,
            type: c.type,
          })),
          type_breakdown: {
            ...(isSampled
              ? {
                  note: `Based on ${sampled} most recent items out of ${total} total`,
                }
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
