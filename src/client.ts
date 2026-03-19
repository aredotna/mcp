import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

export type ArenaClient = ReturnType<typeof createArenaClient>;

export function createArenaClient(token: string) {
  return createClient<paths>({
    baseUrl: "https://api.are.na",
    headers: { Authorization: `Bearer ${token}` },
  });
}
