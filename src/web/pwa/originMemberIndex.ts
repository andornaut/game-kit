export const MAX_ORIGIN_MEMBER_ARCHIVE_BYTES = 24 * 1024 * 1024;
export const MAX_ORIGIN_MEMBER_ARCHIVES = 100;
export const MAX_ORIGIN_MEMBERS = 10_000;

export interface OriginMemberArchive {
  readonly byteSize: number;
  readonly decodedByteSize: number;
  readonly sha256: string;
}

export interface OriginMember {
  readonly archiveSha256: string;
  readonly byteSize: number;
  readonly contentType: string;
  readonly offset: number;
  readonly path: string;
  readonly sha256: string;
}

export interface OriginMemberIndex {
  readonly archives: readonly OriginMemberArchive[];
  readonly members: readonly OriginMember[];
  readonly schema: 1;
}

const PREFIX = "/.game-kit/origin-pack-";
const MEDIA_TYPE =
  /^[\w!#$%&'+.^`|~-]+\/[\w!#$%&'+.^`|~-]+(?:; ?[\w!#$%&'+.^`|~-]+=[\w!#$%&'+.^`|~-]+)*$/;

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function originMemberArchivePath(sha256: string): string {
  if (!isHash(sha256)) {
    throw new TypeError("Invalid origin archive SHA-256");
  }
  return `${PREFIX}${sha256}.bin`;
}

function isPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith(PREFIX)) {
    return false;
  }
  try {
    const decoded = decodeURIComponent(value);
    return (
      !/[\\%?#\p{Cc}]/u.test(decoded) &&
      !decoded.includes("//") &&
      !decoded.split("/").some((segment) => segment === "." || segment === "..") &&
      encodeURI(decoded) === value
    );
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid origin member index record");
  }
  return value as Record<string, unknown>;
}

function isSize(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

export function parseOriginMemberIndex(input: unknown): OriginMemberIndex {
  const { archives, members, schema } = record(input);
  if (
    schema !== 1 ||
    !Array.isArray(archives) ||
    archives.length > MAX_ORIGIN_MEMBER_ARCHIVES ||
    !Array.isArray(members) ||
    members.length > MAX_ORIGIN_MEMBERS
  ) {
    throw new TypeError("Invalid origin member index");
  }

  const byHash = new Map<string, OriginMemberArchive>();
  for (const value of archives as unknown[]) {
    const { byteSize, decodedByteSize, sha256 } = record(value);
    if (
      !isHash(sha256) ||
      byHash.has(sha256) ||
      !isSize(byteSize, MAX_ORIGIN_MEMBER_ARCHIVE_BYTES) ||
      byteSize === 0 ||
      !isSize(decodedByteSize, MAX_ORIGIN_MEMBER_ARCHIVE_BYTES)
    ) {
      throw new TypeError("Invalid or duplicate origin archive");
    }
    byHash.set(sha256, { byteSize, decodedByteSize, sha256 });
  }

  const paths = new Set<string>();
  const ranges = new Map<string, OriginMember[]>();
  const parsedMembers: OriginMember[] = [];
  for (const value of members as unknown[]) {
    const { archiveSha256, byteSize, contentType, offset, path, sha256 } = record(value);
    const archive = isHash(archiveSha256) ? byHash.get(archiveSha256) : undefined;
    if (
      typeof archiveSha256 !== "string" ||
      !archive ||
      !isPath(path) ||
      paths.has(path) ||
      !isHash(sha256) ||
      typeof contentType !== "string" ||
      !MEDIA_TYPE.test(contentType) ||
      !isSize(offset, archive.decodedByteSize) ||
      !isSize(byteSize, archive.decodedByteSize - offset)
    ) {
      throw new TypeError("Invalid or duplicate origin member");
    }
    paths.add(path);
    const member = { archiveSha256, byteSize, contentType, offset, path, sha256 };
    const group = ranges.get(archiveSha256) ?? [];
    group.push(member);
    ranges.set(archiveSha256, group);
    parsedMembers.push(member);
  }

  for (const archive of byHash.values()) {
    const group = ranges.get(archive.sha256);
    if (!group) {
      throw new TypeError("Unreferenced origin archive");
    }
    let end = 0;
    let previous: OriginMember | undefined;
    for (const member of group.sort((a, b) => a.offset - b.offset || a.byteSize - b.byteSize)) {
      if (member.byteSize === 0) {
        continue;
      }
      if (member.offset === end) {
        end += member.byteSize;
        previous = member;
      } else if (
        !previous ||
        member.offset !== previous.offset ||
        member.byteSize !== previous.byteSize ||
        member.sha256 !== previous.sha256
      ) {
        throw new TypeError("Conflicting origin member ranges");
      }
    }
    if (end !== archive.decodedByteSize) {
      throw new TypeError("Incomplete origin archive coverage");
    }
  }

  return { archives: [...byHash.values()], members: parsedMembers, schema: 1 };
}
