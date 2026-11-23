import { buildArchivePartUrl } from "../buildContract.ts";
import {
  encodeUpdateGroupRecipePrefix,
  parseUpdateGroupRecipes,
  type UpdateGroupRecipe,
} from "../buildGroupRecipes.ts";

interface UpdateGroupArchiveReaderContext {
  readonly readMember: (url: string) => Promise<ReadableStream<Uint8Array> | undefined>;
}

export interface UpdateGroupArchiveReader {
  read(path: string): Promise<Response | undefined>;
}

async function readExactMember(
  { readMember }: UpdateGroupArchiveReaderContext,
  url: string,
  target: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const source = await readMember(url);
  if (source === undefined) {
    throw new TypeError(`Missing update group member ${url}`);
  }
  const reader = source.getReader();
  let offset = 0;
  try {
    for (;;) {
      // Read and check each chunk before copying it into the bounded archive buffer.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.byteLength > target.byteLength - offset) {
        throw new RangeError(`Update group member ${url} exceeds its declared size`);
      }
      target.set(value, offset);
      offset += value.byteLength;
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== target.byteLength) {
    throw new RangeError(`Update group member ${url} does not match its declared size`);
  }
}

async function checkDigest(bytes: Uint8Array<ArrayBuffer>, expected: string, label: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== expected) {
    throw new TypeError(`${label} checksum mismatch`);
  }
}

async function reconstruct(
  context: UpdateGroupArchiveReaderContext,
  { archive, files }: UpdateGroupRecipe,
): Promise<Response> {
  const prefix = encodeUpdateGroupRecipePrefix(files);
  const bytes = new Uint8Array(archive.byteSize);
  bytes.set(prefix);
  let offset = prefix.byteLength;
  for (const [url, byteSize, , sha256] of files) {
    const end = offset + byteSize;
    const member = bytes.subarray(offset, end);
    // Reading members in archive order bounds storage calls and verification buffers.
    // eslint-disable-next-line no-await-in-loop
    await readExactMember(context, url, member);
    // eslint-disable-next-line no-await-in-loop
    await checkDigest(member, sha256, `Update group member ${url}`);
    offset = end;
  }
  if (offset !== bytes.byteLength) {
    throw new RangeError("Update group does not match the archive size");
  }
  await checkDigest(bytes, archive.sha256, "Update group archive");
  return new Response(bytes, {
    headers: {
      "content-length": String(bytes.byteLength),
      "content-type": "application/octet-stream",
    },
  });
}

/** Reconstructs verified update archives from caller-owned member storage. */
export function createUpdateGroupArchiveReader(
  context: UpdateGroupArchiveReaderContext,
  recipes: unknown,
): UpdateGroupArchiveReader {
  const { groups } = parseUpdateGroupRecipes(recipes);
  const byPath = new Map(groups.map((recipe) => [buildArchivePartUrl(recipe.archive, 0), recipe]));
  // One bounded archive reconstruction per instance, with no retention of completed archives.
  let queue = Promise.resolve();
  return {
    read(path) {
      const recipe = byPath.get(path);
      if (recipe === undefined) {
        return Promise.resolve(undefined);
      }
      const answer = queue.then(() => reconstruct(context, recipe));
      queue = answer.then(
        () => undefined,
        () => undefined,
      );
      return answer;
    },
  };
}
