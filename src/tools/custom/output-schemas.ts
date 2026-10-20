import { z } from "zod";
import { zodToToolJsonSchema } from "../../lib/portable-json-schema";
import type { OutputSchema } from "../../lib/tool-registry";

function resultSchema(result: z.ZodTypeAny): OutputSchema {
  return {
    ...zodToToolJsonSchema(z.object({ result })),
    type: "object",
  };
}

const identity = z.object({
  slug: z.string(),
  name: z.string(),
  type: z.enum(["User", "Group"]),
});

export const channelDigestOutput = resultSchema(
  z.object({
    channel: z.object({
      id: z.number().int(),
      title: z.string(),
      slug: z.string(),
      visibility: z.enum(["public", "closed", "private"]),
      description: z.string().nullable(),
      created_at: z.string(),
      updated_at: z.string(),
    }),
    owner: identity,
    counts: z.object({
      blocks: z.number().int(),
      channels: z.number().int(),
      contents: z.number().int(),
      collaborators: z.number().int(),
    }),
    collaborators: z.array(identity).optional(),
    type_breakdown: z.record(z.union([z.number().int(), z.string()])),
    active_contributors: z.array(z.string()),
    recent_items: z.array(
      z.object({
        id: z.number().int(),
        type: z.string(),
        title: z.string().optional(),
        added: z.string(),
        added_by: z.string().optional(),
      }),
    ),
  }),
);

export const searchAndConnectOutput = resultSchema(
  z.object({
    query: z.string(),
    target_channel: z.string(),
    found: z.number().int(),
    connected: z.number().int(),
    skipped: z
      .array(z.object({ id: z.number().int(), type: z.string() }))
      .optional(),
    errors: z.array(z.string()).optional(),
    items: z.array(
      z.object({ id: z.number().int(), type: z.enum(["Block", "Channel"]) }),
    ),
  }),
);
