/** Validate and canonicalize the scopes understood by the Are.na API. */
export function normalizeScope(scope: string | undefined): string | null {
  if (scope === undefined) return "write";
  const scopes = scope.split(" ").filter(Boolean);
  if (
    !scopes.length ||
    scopes.some((value) => value !== "read" && value !== "write")
  )
    return null;
  return ["read", "write"].filter((value) => scopes.includes(value)).join(" ");
}
