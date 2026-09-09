/** Severity classification for link-check outcomes. */

import type { Finding } from "./types.ts";

/**
 * Classifies an HTTP status code.
 *
 * The order of these checks is significant: 404/410 are hard failures, a small
 * set of codes indicate the checker was blocked rather than the link being
 * dead, and only then do the generic 5xx/4xx ranges apply.
 */
export function classifyStatus(status: number, url: string): Finding | null {
  if (status === 404 || status === 410) {
    return ["error", `broken link (${status}): ${url}`];
  }
  if (status === 401 || status === 403 || status === 429) {
    return ["warning", `link check blocked (${status}): ${url}`];
  }
  if (status === 408) {
    return ["warning", `link check timed out (${status}): ${url}`];
  }
  if (status >= 500) {
    return ["warning", `remote server error (${status}): ${url}`];
  }
  if (status >= 400) {
    return ["error", `broken link (${status}): ${url}`];
  }
  return null;
}

/**
 * Node equivalents of the Python exception types the original branched on.
 *
 * Python matched `TimeoutError`, `ssl.SSLError`, `socket.gaierror` and
 * `http.client.HTTPException`. Node surfaces the same conditions as error codes
 * and names, usually wrapped inside a `TypeError: fetch failed` with a `cause`.
 */
const TIMEOUT_NAMES = new Set([
  "TimeoutError",
  "AbortError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
]);

const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** DNS resolution failures, matching `socket.gaierror`. */
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL"]);

/** TLS failures, matching `ssl.SSLError`. */
const TLS_CODE_PATTERN = /^(ERR_TLS|ERR_SSL|EPROTO|CERT_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO)/u;

/** Protocol-level interruptions, matching `http.client.HTTPException`. */
const INTERRUPT_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
  "UND_ERR_RESPONSE",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
]);

const INTERRUPT_CODE_PATTERN = /^(HPE_|ERR_HTTP)/u;

const KIND_TIMEOUT = "timeout" as const;
const KIND_UNREACHABLE = "unreachable" as const;
const KIND_INTERRUPTED = "interrupted" as const;

type ErrorKind = typeof KIND_TIMEOUT | typeof KIND_UNREACHABLE | typeof KIND_INTERRUPTED;

interface ErrorSignals {
  readonly codes: string[];
  readonly names: string[];
  readonly messages: string[];
}

/**
 * Walks the `cause` chain, collecting every code, name and message.
 *
 * This is the analogue of unwrapping `URLError.reason`, except Node can nest
 * the real cause several levels deep.
 */
function collectSignals(error: unknown): ErrorSignals {
  const codes: string[] = [];
  const names: string[] = [];
  const messages: string[] = [];
  const seen = new Set<object>();

  let current: unknown = error;
  while (current !== null && current !== undefined) {
    if (typeof current !== "object") {
      messages.push(String(current));
      break;
    }
    if (seen.has(current)) {
      break;
    }
    seen.add(current);

    const record = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof record.code === "string") {
      codes.push(record.code);
    }
    if (typeof record.name === "string") {
      names.push(record.name);
    }
    if (typeof record.message === "string" && record.message !== "") {
      messages.push(record.message);
    }
    current = record.cause;
  }

  return { codes, names, messages };
}

function classifyKind(signals: ErrorSignals): ErrorKind {
  const { codes, names } = signals;
  if (codes.some((code) => TIMEOUT_CODES.has(code)) || names.some((name) => TIMEOUT_NAMES.has(name))) {
    return KIND_TIMEOUT;
  }
  if (codes.some((code) => DNS_CODES.has(code) || TLS_CODE_PATTERN.test(code))) {
    return KIND_UNREACHABLE;
  }
  if (codes.some((code) => INTERRUPT_CODES.has(code) || INTERRUPT_CODE_PATTERN.test(code))) {
    return KIND_INTERRUPTED;
  }
  return KIND_UNREACHABLE;
}

/**
 * Classifies a transport-level failure.
 *
 * Timeouts and protocol interruptions are warnings because they usually
 * indicate a flaky network rather than a dead link; DNS, TLS and everything
 * else are errors.
 */
export function classifyException(error: unknown, url: string): Finding {
  const signals = collectSignals(error);
  // The innermost message is the closest analogue of `URLError.reason`.
  const reason = signals.messages[signals.messages.length - 1] ?? String(error);

  switch (classifyKind(signals)) {
    case KIND_TIMEOUT:
      return ["warning", `link check timed out: ${url} (${reason})`];
    case KIND_INTERRUPTED:
      return ["warning", `link check interrupted: ${url} (${reason})`];
    case KIND_UNREACHABLE:
      return ["error", `unreachable link: ${url} (${reason})`];
  }
}
