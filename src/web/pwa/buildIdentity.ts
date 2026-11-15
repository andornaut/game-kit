// A grouped application and its service worker share one full immutable source identity.
export function isBuildId(value: unknown): value is string {
  return typeof value === "string" && value.length === 40 && /^[0-9a-f]{40}$/.test(value);
}
