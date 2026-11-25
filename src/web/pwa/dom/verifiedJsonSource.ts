// The verified JSON response rules (verifiedJsonBody) that the page installer applies before it
// stores a family member and the router applies before it serves or stores one.
import { BUILD_HASH_HEADER } from "../buildContract.ts";
import type { VerifiedJsonBody } from "../verifiedJsonBody.ts";

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:"utf-8"|utf-8))?\s*$/i;

// Response headers that change what a verified JSON body means or which cached response it is.
// Any other header, such as a CDN's transport or diagnostic headers (priority, server-timing) or
// HTTP/1.1 connection and keep-alive, carries no body semantics and is ignored. content-type,
// cache-control, vary, content-encoding, content-length and x-content-type-options are checked
// by value.
const JSON_SEMANTIC_HEADERS = [
  "clear-site-data",
  "content-disposition",
  "content-location",
  "content-range",
  "refresh",
  "set-cookie",
] as const;

// JSON with UTF-8 or no charset.
export function isJsonContentType(contentType: string | null): boolean {
  return JSON_CONTENT_TYPE.test(contentType ?? "");
}

// A family whose body may answer a guarded data request at another member's URL.
export function isDataProfile(family: VerifiedJsonBody): boolean {
  return family.responseProfile === "fetch-json-data-v1";
}

// A guarded data request: the only context a fetch-json-data-v1 body alias may answer.
export function isDataRequest(request: Request): boolean {
  return (
    request.destination === "" &&
    request.mode !== "navigate" &&
    !request.headers.has("range") &&
    !request.headers.has("if-range")
  );
}

// Whether a verified JSON response's status and headers leave its body's meaning unchanged.
function safeJsonHeaders(family: VerifiedJsonBody, response: Response): boolean {
  const { headers } = response;
  if (
    response.status !== 200 ||
    response.redirected ||
    !isJsonContentType(headers.get("content-type")) ||
    JSON_SEMANTIC_HEADERS.some((name) => headers.has(name)) ||
    /(?:^|,)\s*(?:private|no-store)(?:\s|,|=|$)/i.test(headers.get("cache-control") ?? "") ||
    (headers.get("vary") ?? "")
      .split(",")
      .some((name) => name.trim() !== "" && name.trim().toLowerCase() !== "accept-encoding") ||
    (headers.has("x-content-type-options") &&
      headers.get("x-content-type-options")?.toLowerCase() !== "nosniff")
  ) {
    return false;
  }
  const encoding = headers.get("content-encoding")?.toLowerCase();
  const encodings = [
    "identity",
    "gzip",
    "br",
    "deflate",
    ...(isDataProfile(family) ? ["zstd"] : []),
  ];
  if (encoding !== undefined && !encodings.includes(encoding)) {
    return false;
  }
  const length = headers.get("content-length");
  return (
    length === null ||
    (/^\d+$/.test(length) &&
      Number.isSafeInteger(Number(length)) &&
      ((encoding !== undefined && encoding !== "identity") || Number(length) === family.byteSize))
  );
}

// A network response qualifies only from the exact same-origin URL it was requested at.
export function safeJsonSource(
  origin: string,
  family: VerifiedJsonBody,
  url: string,
  response: Response,
): boolean {
  return (
    safeJsonHeaders(family, response) &&
    response.url !== "" &&
    new URL(response.url).origin === origin &&
    response.url === new URL(url, origin).href
  );
}

// A stored entry is trusted by the digest header its writer set after verifying the body, so it
// needs no source URL: content-type and BUILD_HASH_HEADER are enough, and any other headers it
// carries must still pass safeJsonHeaders.
export function safeStoredJson(family: VerifiedJsonBody, response: Response): boolean {
  return (
    response.headers.get(BUILD_HASH_HEADER) === family.sha256 && safeJsonHeaders(family, response)
  );
}
