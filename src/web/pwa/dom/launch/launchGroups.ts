// Grouped builds for dom/launch: reuses or downloads each group the deployed pointer names, seals
// the build and checks its members against the manifest, then activates it as a first install or
// publishes it as the staged update. createLaunch supplies the page, stores and its own state.
import {
  bootBytesOf,
  type BuildGroupReference,
  buildGroupTransferBytes,
  type BuildManifest,
  type BuildPointer,
  type BuildPolicy,
  type BuildState,
  groupedManifestMismatch,
  installedManifest,
  LaunchError,
  sameDeployedGroups,
  type UpdateState,
} from "../../index.ts";
import { activeGroupFormat, type BuildGroupStore } from "../storage/buildGroupStore.ts";
import { type BuildStore, withBuildStateLock } from "../storage/buildStore.ts";

type GroupFetch = (input: string, init?: RequestInit) => Promise<Response>;
type GroupBytes = (received: number, total: number) => void;

export interface LaunchGroupsContext {
  // Downloads a group's transport through fetch, or the page's fetch when it is undefined, and
  // returns its verified decoded archive.
  downloadGroup(group: BuildGroupReference, onBytes: GroupBytes, fetch?: GroupFetch): Promise<Blob>;
  readonly fetch: GroupFetch;
  // Whether the controlling router answers the group probe.
  groupRouterReady(): Promise<boolean>;
  readonly groupStore: BuildGroupStore | undefined;
  readonly policy: BuildPolicy;
  readDeployedManifest(pointer: BuildPointer): Promise<BuildManifest>;
  // The deployed pointer, its groups reduced to the ones this device installs.
  readPointer(): Promise<BuildPointer>;
  readonly signal: AbortSignal;
  readonly soundFormat: string | undefined;
  readonly store: Pick<BuildStore, "readState" | "setActive">;
}

export interface GroupedInstallContext extends LaunchGroupsContext {
  disposed(): boolean;
  // First-install progress: the boot bytes of the build, the transport bytes received, and the
  // active record written for version.
  onBootBytes(bootBytes: number): void;
  onBytes: GroupBytes;
  onRecorded(version: string): void;
  reload(): void;
  // Resolves once the router controls the page, or after its wait.
  waitForRouter(): Promise<void>;
}

export interface GroupedStagingContext extends LaunchGroupsContext {
  // Stages version unless another context changed the build state since previous.
  publishStaged(previous: BuildState, version: string, pointer: BuildPointer): Promise<void>;
  onTransfer?(version: string, received: number, total: number): void;
  onVerify?(version: string): void;
  reportUpdate(state: UpdateState): void;
}

export interface PrepareGroupsOptions {
  // A first install reports zero bytes and rereads the pointer even when nothing is missing, and
  // treats a failed group fetch as a possible redeploy.
  readonly foreground: boolean;
  readonly onBytes: GroupBytes;
  readonly onVerify?: () => void;
  readonly revalidatePointer?: boolean;
  readonly seal?: (pointer: BuildPointer, signal: AbortSignal) => Promise<void>;
}

async function requireGroupRouter(context: Pick<LaunchGroupsContext, "groupRouterReady">) {
  if (!(await context.groupRouterReady())) {
    throw new LaunchError("verification", "The controlling worker cannot serve grouped builds");
  }
}

// Stores and seals every group the pointer names, downloading only the missing ones. "changed":
// the deployed pointer no longer names these groups.
export async function prepareGroups(
  context: LaunchGroupsContext,
  { foreground, onBytes, onVerify, revalidatePointer, seal }: PrepareGroupsOptions,
  pointer: BuildPointer,
): Promise<"complete" | "changed"> {
  const { groupStore, signal } = context;
  const { groups, version } = pointer;
  if (groupStore === undefined || groups === undefined) {
    throw new LaunchError("verification", "Grouped build storage unavailable");
  }
  const stillDeployed = (deployed: BuildPointer) => sameDeployedGroups(pointer, deployed);
  const alreadySealed = await groupStore.complete(version, pointer);
  if (!alreadySealed) {
    const missing: BuildGroupReference[] = [];
    for (const group of groups) {
      signal.throwIfAborted();
      // Limit storage work and downloads to one bounded group at a time.
      // eslint-disable-next-line no-await-in-loop
      if (!(await groupStore.reuse(pointer, group))) {
        missing.push(group);
      }
    }
    // Progress counts transport bytes, which a compressed group sends fewer of.
    const total = missing.reduce((bytes, group) => bytes + buildGroupTransferBytes(group), 0);
    let received = 0;
    if (total > 0 || foreground) {
      onBytes(0, total);
    }
    for (const group of missing) {
      let fetchFailed = false;
      const foregroundFetch: GroupFetch | undefined = foreground
        ? async (url, init) => {
            const response = await context.fetch(url, init).catch((error: unknown) => {
              fetchFailed = true;
              throw error;
            });
            fetchFailed = response.status !== 200;
            return response;
          }
        : undefined;
      try {
        // eslint-disable-next-line no-await-in-loop
        const body = await context.downloadGroup(
          group,
          (bytes) => onBytes(received + bytes, total),
          foregroundFetch,
        );
        // eslint-disable-next-line no-await-in-loop
        await groupStore.put(pointer, group, body, signal);
      } catch (error) {
        if (fetchFailed && !signal.aborted) {
          // The old part may have disappeared during a current-only deployment.
          // eslint-disable-next-line no-await-in-loop
          const deployed = await context.readPointer().catch(() => undefined);
          if (deployed !== undefined && !stillDeployed(deployed) && !signal.aborted) {
            return "changed";
          }
        }
        throw error;
      }
      received += buildGroupTransferBytes(group);
    }
  }
  onVerify?.();
  if (
    (!alreadySealed || foreground || revalidatePointer === true) &&
    !stillDeployed(await context.readPointer())
  ) {
    return "changed";
  }
  if (!alreadySealed) {
    if (seal === undefined) {
      await groupStore.seal(pointer, signal);
    } else {
      await seal(pointer, signal);
    }
  }
  return "complete";
}

// Repair only the sound selection of the active build. Verify the candidate before publishing
// its marker, then recheck the startup records under the same lock as the marker write.
export async function recoverActiveGroups(context: LaunchGroupsContext, startup: BuildState) {
  const { active, staged } = startup;
  const format = activeGroupFormat(context.groupStore);
  if (
    active === undefined ||
    format === undefined ||
    !(await format.mayDiffer(active, context.soundFormat))
  ) {
    return;
  }
  const pointer = await context.readPointer();
  if (
    pointer.version !== active ||
    pointer.groups === undefined ||
    !(await format.differs(pointer)) ||
    !(await context.groupRouterReady())
  ) {
    return;
  }
  const manifest = await context.readDeployedManifest(pointer);
  await prepareGroups(
    {
      ...context,
      downloadGroup(group, onBytes) {
        if (group.soundFormat === undefined) {
          throw new LaunchError("verification", "The active build is missing a shared group");
        }
        return context.downloadGroup(group, onBytes);
      },
    },
    {
      foreground: false,
      onBytes: () => undefined,
      seal: (candidate, signal) =>
        format.seal(candidate, signal, async (files) => {
          if (groupedManifestMismatch(context.soundFormat, manifest, files) !== undefined) {
            return false;
          }
          const current = await context.store.readState();
          return current.active === active && current.staged === staged;
        }),
    },
    pointer,
  );
}

// The stored groups hold the deployed manifest's files (launchRules' groupedManifestMismatch).
export async function verifyGroupedManifest(
  context: Pick<LaunchGroupsContext, "groupStore" | "soundFormat">,
  deployed: BuildManifest,
): Promise<void> {
  const grouped = await context.groupStore?.read(deployed.version);
  if (grouped?.kind !== "ready") {
    throw new LaunchError("verification", "Grouped build members do not match the manifest");
  }
  const mismatch = groupedManifestMismatch(context.soundFormat, deployed, grouped.files);
  if (mismatch !== undefined) {
    throw new LaunchError("verification", mismatch);
  }
}

// A grouped first install, in the foreground once the router controls the page. It activates the
// sealed build unless another context activated one, then reloads into the router.
export async function installGrouped(
  context: GroupedInstallContext,
  pointer: BuildPointer,
): Promise<"reloading" | "changed"> {
  const { signal, store } = context;
  const { version } = pointer;
  await context.waitForRouter();
  signal.throwIfAborted();
  await requireGroupRouter(context);
  const manifest = await context.readDeployedManifest(pointer);
  context.onBootBytes(bootBytesOf(installedManifest(context.soundFormat, manifest)));
  const result = await prepareGroups(
    context,
    { foreground: true, onBytes: context.onBytes },
    pointer,
  );
  if (result === "changed") {
    return result;
  }
  await verifyGroupedManifest(context, manifest);
  const active = await withBuildStateLock(context.policy, async () => {
    const state = await store.readState();
    if (state.active !== undefined) {
      return state.active;
    }
    if (
      !(await context.groupStore?.complete(version, pointer)) ||
      !(await context.groupRouterReady())
    ) {
      throw new LaunchError("verification", "Could not activate the sealed grouped build");
    }
    signal.throwIfAborted();
    await store.setActive(version);
    return version;
  });
  if (context.disposed()) {
    return "reloading";
  }
  if (active === version) {
    context.onRecorded(version);
  }
  // Bootstrap has no pin yet. The new navigation obtains the active build and its pin together.
  context.reload();
  return "reloading";
}

// Stages a grouped update from previous's build state and publishes it once its members match.
export async function stageGroups(
  context: GroupedStagingContext,
  previous: BuildState,
  pointer: BuildPointer,
  revalidatePointer = false,
): Promise<"complete" | "changed"> {
  await requireGroupRouter(context);
  const manifest = await context.readDeployedManifest(pointer);
  const result = await prepareGroups(
    context,
    {
      foreground: false,
      onBytes: (received, total) => {
        context.reportUpdate({
          phase: "staging",
          value: received / total,
          version: pointer.version,
        });
        context.onTransfer?.(pointer.version, received, total);
      },
      onVerify: () => context.onVerify?.(pointer.version),
      revalidatePointer,
    },
    pointer,
  );
  if (result === "complete") {
    await verifyGroupedManifest(context, manifest);
    await context.publishStaged(previous, pointer.version, pointer);
  }
  return result;
}
