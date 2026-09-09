/**
 * URL normalisation used to detect duplicate resources.
 *
 * This is a deliberate port of Python's `urllib.parse.urlsplit`/`urlunsplit`
 * rather than a wrapper around the WHATWG `URL` class. `new URL()` re-encodes
 * path and query characters, forces a `/` path, drops scheme-default ports
 * unconditionally and applies IDN mapping to hosts. Any of those would change
 * which entries are considered duplicates.
 */

import { ipAddressKind } from "./pythonIpAddress.ts";

/** Raised when a URL cannot be parsed, mirroring Python's `ValueError`. */
export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUrlError";
  }
}

/** Characters permitted in a scheme by `urllib.parse`. */
const SCHEME_CHARS = /^[A-Za-z][A-Za-z0-9+\-.]*$/u;

/**
 * Mirrors CPython's `SplitResult.port` guard, which is
 * `port.isdigit() and port.isascii()`. A sign, whitespace, or a non-ASCII digit
 * such as `٣` therefore fails the *cast* check rather than the range check.
 */
const PORT_CHARS = /^[0-9]+$/u;

interface UrlParts {
  readonly scheme: string;
  readonly netloc: string;
  readonly path: string;
  readonly query: string;
}

const UNSAFE_URL_BYTES = /[\t\r\n]/gu;
const C0_CONTROL_OR_SPACE = /^[\u0000-\u0020]+/u;
const IPV_FUTURE = /^[vV][a-fA-F0-9]+\..+$/u;

function stripLeadingC0OrSpace(url: string): string {
  return url.replace(C0_CONTROL_OR_SPACE, "");
}

function checkBracketedHost(hostname: string): void {
  if (hostname.startsWith("v") || hostname.startsWith("V")) {
    if (!IPV_FUTURE.test(hostname)) {
      throw new InvalidUrlError("IPvFuture address is invalid");
    }
    return;
  }
  const kind = ipAddressKind(hostname);
  if (kind === null) {
    throw new InvalidUrlError(
      `${pythonRepr(hostname)} does not appear to be an IPv4 or IPv6 address`,
    );
  }
  if (kind === "ipv4") {
    throw new InvalidUrlError("An IPv4 address cannot be in brackets");
  }
}

/** Port of `_check_bracketed_netloc`; mirrors the splitting done by `hostInfo`. */
function checkBrackets(netloc: string): void {
  const hasOpen = netloc.includes("[");
  const hasClose = netloc.includes("]");
  if (hasOpen !== hasClose) {
    throw new InvalidUrlError("Invalid IPv6 URL");
  }
  if (!hasOpen) {
    return;
  }

  const at = netloc.lastIndexOf("@");
  const hostAndPort = at === -1 ? netloc : netloc.slice(at + 1);
  const open = hostAndPort.indexOf("[");

  let hostname: string;
  if (open === -1) {
    const colon = hostAndPort.indexOf(":");
    hostname = colon === -1 ? hostAndPort : hostAndPort.slice(0, colon);
  } else {
    if (open !== 0) {
      throw new InvalidUrlError("Invalid IPv6 URL");
    }
    const bracketed = hostAndPort.slice(1);
    const close = bracketed.indexOf("]");
    hostname = close === -1 ? bracketed : bracketed.slice(0, close);
    const trailing = close === -1 ? "" : bracketed.slice(close + 1);
    if (trailing !== "" && !trailing.startsWith(":")) {
      throw new InvalidUrlError("Invalid IPv6 URL");
    }
  }
  checkBracketedHost(hostname);
}

/**
 * Port of `_checknetloc`. Characters such as `\u2100` decompose to `a/c` under
 * the NFKC mapping IDNA applies, which would smuggle a delimiter into the host.
 */
function checkNetloc(netloc: string): void {
  if (netloc === "" || isAscii(netloc)) {
    return;
  }
  const stripped = netloc.replace(/[@:#?]/gu, "");
  const normalized = stripped.normalize("NFKC");
  if (stripped === normalized) {
    return;
  }
  for (const character of "/?#@:") {
    if (normalized.includes(character)) {
      throw new InvalidUrlError(
        `netloc '${netloc}' contains invalid characters under NFKC normalization`,
      );
    }
  }
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 127) {
      return false;
    }
  }
  return true;
}

function firstIndexOfAny(value: string, characters: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (characters.includes(value.charAt(index))) {
      return index;
    }
  }
  return -1;
}

/** Port of `urllib.parse.urlsplit`, with the fragment discarded by the caller. */
function urlSplit(url: string): UrlParts {
  let rest = stripLeadingC0OrSpace(url).replace(UNSAFE_URL_BYTES, "");
  let scheme = "";

  const colon = rest.indexOf(":");
  if (colon > 0 && SCHEME_CHARS.test(rest.slice(0, colon))) {
    scheme = rest.slice(0, colon).toLowerCase();
    rest = rest.slice(colon + 1);
  }

  let netloc = "";
  if (rest.startsWith("//")) {
    const authority = rest.slice(2);
    const end = firstIndexOfAny(authority, "/?#");
    netloc = end === -1 ? authority : authority.slice(0, end);
    rest = end === -1 ? "" : authority.slice(end);
    checkBrackets(netloc);
  }
  checkNetloc(netloc);

  const hash = rest.indexOf("#");
  if (hash !== -1) {
    rest = rest.slice(0, hash);
  }

  let query = "";
  const question = rest.indexOf("?");
  if (question !== -1) {
    query = rest.slice(question + 1);
    rest = rest.slice(0, question);
  }

  return { scheme, netloc, path: rest, query };
}

/**
 * Port of `SplitResult._hostinfo`.
 *
 * Userinfo is dropped, and an IPv6 literal loses its surrounding brackets
 * exactly as Python's `.hostname` does.
 */
function hostInfo(netloc: string): { hostname: string; port: string | null } {
  const at = netloc.lastIndexOf("@");
  const hostinfo = at === -1 ? netloc : netloc.slice(at + 1);

  const open = hostinfo.indexOf("[");
  let hostname: string;
  let port: string;

  if (open !== -1) {
    const bracketed = hostinfo.slice(open + 1);
    const close = bracketed.indexOf("]");
    hostname = close === -1 ? bracketed : bracketed.slice(0, close);
    const trailing = close === -1 ? "" : bracketed.slice(close + 1);
    const colon = trailing.indexOf(":");
    port = colon === -1 ? "" : trailing.slice(colon + 1);
  } else {
    const colon = hostinfo.indexOf(":");
    hostname = colon === -1 ? hostinfo : hostinfo.slice(0, colon);
    port = colon === -1 ? "" : hostinfo.slice(colon + 1);
  }

  return { hostname, port: port === "" ? null : port };
}

/**
 * `SplitResult.hostname` deliberately preserves the case of an IPv6 zone id,
 * but `normalize_url` then calls `.lower()` on the result, so the zone is
 * lowercased too and the distinction collapses.
 */
function lowerHostname(hostname: string): string {
  return hostname.toLowerCase();
}

/** The categories for which Python's `str.isprintable()` is false, less U+0020. */
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

function escapeCodePoint(codePoint: number): string {
  if (codePoint < 0x100) {
    return `\\x${codePoint.toString(16).padStart(2, "0")}`;
  }
  if (codePoint < 0x10000) {
    return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  }
  return `\\U${codePoint.toString(16).padStart(8, "0")}`;
}

/** Reproduces Python's `repr()` for a string, used in the port error message. */
function pythonRepr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let body = "";
  for (const character of value) {
    if (character === "\\") {
      body += "\\\\";
    } else if (character === quote) {
      body += `\\${character}`;
    } else if (character === "\n") {
      body += "\\n";
    } else if (character === "\r") {
      body += "\\r";
    } else if (character === "\t") {
      body += "\\t";
    } else if (character !== " " && NON_PRINTABLE.test(character)) {
      body += escapeCodePoint(character.codePointAt(0) ?? 0);
    } else {
      body += character;
    }
  }
  return `${quote}${body}${quote}`;
}

/** Port of `SplitResult.port`, including both `ValueError` messages. */
function parsePort(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  if (!PORT_CHARS.test(raw)) {
    throw new InvalidUrlError(`Port could not be cast to integer value as ${pythonRepr(raw)}`);
  }
  const port = Number.parseInt(raw, 10);
  if (!(port >= 0 && port <= 65535)) {
    throw new InvalidUrlError("Port out of range 0-65535");
  }
  return port;
}

const USES_NETLOC: ReadonlySet<string> = new Set([
  "", "ftp", "http", "gopher", "nntp", "telnet", "imap", "wais", "file", "mms",
  "https", "shttp", "snews", "prospero", "rtsp", "rtsps", "rtspu", "rsync",
  "svn", "svn+ssh", "sftp", "nfs", "git", "git+ssh", "ws", "wss",
  "itms-services",
]);

/**
 * A hostless URL such as `https://@/a` still keeps its `//` separator, so
 * `urlunsplit` yields `https:///a` rather than `https:/a`.
 */
function emitsEmptyNetloc(scheme: string, path: string): boolean {
  return scheme !== "" && USES_NETLOC.has(scheme) && (path === "" || path.startsWith("/"));
}

/** Port of `urllib.parse.urlunsplit` with an always-empty fragment. */
function urlUnsplit(scheme: string, netloc: string, path: string, query: string): string {
  let url = path;
  if (netloc !== "" || emitsEmptyNetloc(scheme, url)) {
    if (url !== "" && !url.startsWith("/")) {
      url = `/${url}`;
    }
    url = `//${netloc}${url}`;
  } else if (url.startsWith("//")) {
    url = `//${url}`;
  }
  if (scheme !== "") {
    url = `${scheme}:${url}`;
  }
  if (query !== "") {
    url = `${url}?${query}`;
  }
  return url;
}

/** Removes every trailing `/`, matching Python's `str.rstrip("/")`. */
function stripTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charAt(end - 1) === "/") {
    end -= 1;
  }
  return path.slice(0, end);
}

/**
 * Produces the canonical form used as a duplicate-detection key.
 *
 * Lowercases the scheme and host, drops the fragment and any userinfo, removes
 * a redundant `:443` on HTTPS, strips trailing slashes from the path and keeps
 * the query string.
 *
 * @throws {InvalidUrlError} when the port is not a valid integer or is out of range.
 */
export function normalizeUrl(url: string): string {
  const parts = urlSplit(url);
  const { hostname, port: rawPort } = hostInfo(parts.netloc);
  const port = parsePort(rawPort);

  let host = lowerHostname(hostname);
  // `if port and not (...)` in Python: port 0 is falsy and so is never appended.
  if (port !== null && port !== 0 && !(parts.scheme === "https" && port === 443)) {
    host = `${host}:${port}`;
  }

  const path = stripTrailingSlashes(parts.path) || "/";
  return urlUnsplit(parts.scheme, host, path, parts.query);
}
