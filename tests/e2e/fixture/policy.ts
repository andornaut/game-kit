// The fixture game's cache policy, shared by its page, its router worker and the runner.
export const POLICY = { cacheNamePrefix: "e2e-", hashedAssetPrefix: "/assets/" } as const;
// The delayed save lets the runners verify ordering across navigation.
export const SAVE_MS = 1500;
