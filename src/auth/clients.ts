import { z } from "zod";
import { OAuthStore, type OAuthClient } from "./store";

// Trust only vendor-controlled metadata endpoints. Do not turn client_id into
// an arbitrary server-side fetch (including through redirects or DNS aliases).
export function isTrustedClientMetadataUrl(clientId: string): boolean {
  return (
    clientId === "https://claude.ai/oauth/mcp-oauth-client-metadata" ||
    /^https:\/\/chatgpt\.com\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/.test(
      clientId,
    )
  );
}

// Native apps may use private-use schemes (RFC 8252), e.g. cursor://.
const UNSAFE_SCHEMES = ["javascript:", "data:", "vbscript:", "file:", "blob:"];

export function isValidRedirectUri(value: string): boolean {
  try {
    if (!/^[a-z][a-z0-9+.-]*:[^\s\\]+$/i.test(value)) return false;
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.hash ||
      value.includes("#") ||
      value.includes("*")
    )
      return false;
    if (url.protocol === "http:")
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return !UNSAFE_SCHEMES.includes(url.protocol);
  } catch {
    return false;
  }
}

const clientMetadata = z.object({
  redirect_uris: z
    .array(z.string().max(2048).refine(isValidRedirectUri))
    .min(1)
    .max(20),
  client_name: z.string().trim().min(1).max(200).optional(),
  grant_types: z
    .array(z.string())
    .refine((types) => types.includes("authorization_code"))
    .optional(),
  response_types: z
    .array(z.string())
    .refine((types) => types.includes("code"))
    .optional(),
});

export const registrationMetadata = clientMetadata.extend({
  // RFC 7591's client_secret_basic default is unsupported; issue a POST secret.
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_post"])
    .default("client_secret_post"),
});

const publishedMetadata = clientMetadata.extend({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(200),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).min(1).optional(),
});

const MAX_METADATA_BYTES = 32 * 1024;

async function readMetadata(response: Response): Promise<unknown> {
  if (
    !response.ok ||
    !response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .match(/^application\/(?:[\w.+-]+\+)?json$/i)
  ) {
    await response.body?.cancel();
    throw new Error("Invalid client metadata response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty client metadata response");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_METADATA_BYTES)
        throw new Error("Client metadata is too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel();
  }
}

function cacheSeconds(headers: Headers): number {
  const control = headers.get("cache-control") ?? "";
  if (/(?:^|,)\s*(?:no-store|no-cache|private)(?:\s|,|=|$)/i.test(control))
    return 0;
  const match = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?(?:\s|,|$)/i.exec(control);
  if (!match) return 0;
  const age = Number(headers.get("age") ?? 0);
  if (!Number.isFinite(age) || age < 0) return 0;
  return Math.max(0, Math.min(300, Number(match[1]) - age));
}

export async function resolveClient(
  clientId: string,
  store: OAuthStore,
): Promise<OAuthClient | null> {
  // Generated DCR IDs are opaque hex strings, never URLs.
  if (/^[a-f0-9]{32}$/.test(clientId)) return store.getClient(clientId);
  if (!isTrustedClientMetadataUrl(clientId)) return null;

  const cached = await store.getClientMetadata(clientId);
  if (cached) return cached;

  try {
    const response = await fetch(clientId, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    const parsed = publishedMetadata.safeParse(await readMetadata(response));
    if (!parsed.success || parsed.data.client_id !== clientId) return null;
    const metadata = parsed.data;
    // ChatGPT publishes a plural list during the CIMD transition. Choose the
    // intersection with our supported methods; a public document has no secret.
    const methods = metadata.token_endpoint_auth_methods_supported ?? [
      metadata.token_endpoint_auth_method ?? "none",
    ];
    if (!methods.includes("none")) return null;

    const client: OAuthClient = {
      client_id: clientId,
      client_name: metadata.client_name,
      redirect_uris: metadata.redirect_uris,
      token_endpoint_auth_method: "none",
      created_at: Date.now(),
    };
    const ttl = cacheSeconds(response.headers);
    // Caching is best effort; a failed write must not reject a valid client.
    if (ttl >= 60) await store.putClientMetadata(client, ttl).catch(() => {});
    return client;
  } catch {
    // Unreachable, malformed, redirected, oversized, or timed-out documents
    // must never authorize a client or fall back to stale metadata.
    return null;
  }
}
