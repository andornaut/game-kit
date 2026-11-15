export interface PrecacheGroups {
  readonly initial: readonly string[];
  readonly urls: Readonly<Record<string, readonly string[]>>;
}

// Validate against the complete final normalized inventory, including every audio alternative,
// before selecting a format. Return copied, deduplicated metadata; initial ID order is retained.
// Classification and normalization belong to the caller, never to a URL prefix convention.
export function validatePrecacheGroups(
  availableUrls: readonly string[],
  groups: PrecacheGroups,
): PrecacheGroups {
  if (
    groups === null ||
    typeof groups !== "object" ||
    !Array.isArray(groups.initial) ||
    groups.urls === null ||
    typeof groups.urls !== "object" ||
    Array.isArray(groups.urls)
  ) {
    throw new TypeError("Precache groups require initial IDs and a URL record");
  }
  const available = new Set(availableUrls);
  const assigned = new Map<string, string>();
  const entries = Object.getOwnPropertyNames(groups.urls)
    .sort()
    .map((id) => {
      const members = groups.urls[id]!;
      if (!Array.isArray(members)) {
        throw new TypeError(`Precache group ${id} requires a URL array`);
      }
      const urls = [...new Set<string>(members)].sort();
      for (const url of urls) {
        if (typeof url !== "string" || !available.has(url)) {
          throw new RangeError(`Unknown precache URL in group ${id}: ${String(url)}`);
        }
        if (assigned.has(url)) {
          throw new RangeError(`Precache URL belongs to multiple groups: ${url}`);
        }
        assigned.set(url, id);
      }
      return [id, urls] as const;
    });
  const urls = Object.fromEntries(entries);
  const initial = [...new Set<string>(groups.initial)];
  validateIds(urls, initial);
  return { initial, urls };
}

function validateIds(
  groups: Readonly<Record<string, readonly string[]>>,
  ids: readonly string[],
): void {
  for (const id of ids) {
    if (typeof id !== "string" || !Object.hasOwn(groups, id)) {
      throw new RangeError(`Unknown precache group: ${String(id)}`);
    }
  }
}

// Plan from a validated partition and the caller's selected URL inventory (audio already chosen).
// Every unassigned selected URL is mandatory, including caller-classified shared dependencies.
export function basePrecacheUrls(
  groups: PrecacheGroups,
  selectedUrls: readonly string[],
): string[] {
  const assigned = new Set(Object.values(groups.urls).flat());
  return [...new Set(selectedUrls)].filter((url) => !assigned.has(url)).sort();
}

// Validate the entire request before deriving its selected-format URL union. For an install,
// pass the union of initial, prior-ready and requested IDs; ensure operations can pass only IDs
// requested now. This function owns neither readiness nor the choice of IDs to retain.
export function precacheGroupUrls(
  context: { readonly groups: PrecacheGroups; readonly selectedUrls: readonly string[] },
  ids: readonly string[],
): string[] {
  const { groups } = context;
  validateIds(groups.urls, ids);
  const requested = new Set(ids.flatMap((id) => groups.urls[id]!));
  return [...new Set(context.selectedUrls)].filter((url) => requested.has(url)).sort();
}
