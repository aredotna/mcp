import type { components } from "../generated/schema";

export const textBlock = {
  id: 1,
  base_type: "Block",
  type: "Text",
  title: null,
  description: null,
  state: "available",
  visibility: "public",
  comment_count: 0,
  created_at: "2026-10-20T12:00:00Z",
  updated_at: "2026-10-20T12:00:00Z",
  user: {
    id: 2,
    type: "User",
    name: "Example",
    slug: "example",
    avatar: null,
    initials: "E",
  },
  _links: {
    self: { href: "https://api.are.na/v3/blocks/1" },
    comments: { href: "https://api.are.na/v3/blocks/1/comments" },
  },
  content: { markdown: "Hello", html: "<p>Hello</p>", plain: "Hello" },
  metadata: { status: "reviewed", score: 0.5, featured: true },
} satisfies components["schemas"]["TextBlock"];
