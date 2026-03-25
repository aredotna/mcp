/**
 * Crypto helpers for OAuth flows. Uses the Web Crypto API
 * available in Cloudflare Workers.
 */

export function generateId(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify a PKCE code_verifier against a stored code_challenge.
 * Only S256 is supported (plain is insecure and not recommended by OAuth 2.1).
 */
export async function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  method: string,
): Promise<boolean> {
  if (method !== "S256") return false;

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const computed = base64UrlEncode(new Uint8Array(digest));
  return computed === codeChallenge;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
