import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidUrlError, normalizeUrl } from "../src/normalizeUrl.ts";

test("validate_readme::test_normalize_url - lowercases, drops the default port, trims the path and discards the fragment", () => {
  assert.equal(
    normalizeUrl("HTTPS://EXAMPLE.COM:443/path/?q=1#fragment"),
    "https://example.com/path?q=1",
  );
});

test("keeps a non-default port", () => {
  assert.equal(normalizeUrl("https://example.com:8080/thing/"), "https://example.com:8080/thing");
});

test("drops a zero port because Python treats it as falsy", () => {
  assert.equal(normalizeUrl("https://example.com:0/thing"), "https://example.com/thing");
});

test("normalises leading zeros in a port", () => {
  assert.equal(normalizeUrl("https://example.com:08080/x"), "https://example.com:8080/x");
});

test("collapses a bare host and a trailing slash to the same key", () => {
  assert.equal(normalizeUrl("https://example.com"), "https://example.com/");
  assert.equal(normalizeUrl("https://example.com/"), "https://example.com/");
  assert.equal(normalizeUrl("https://example.com///"), "https://example.com/");
});

test("preserves the query but never emits a fragment", () => {
  assert.equal(normalizeUrl("https://example.com/a?b=c#d"), "https://example.com/a?b=c");
  assert.equal(normalizeUrl("https://example.com/a#d"), "https://example.com/a");
});

test("drops userinfo the way Python's hostname property does", () => {
  assert.equal(normalizeUrl("https://user:pass@example.com/a"), "https://example.com/a");
});

test("does not percent-encode path characters", () => {
  // The WHATWG URL parser would rewrite these; urlsplit leaves them alone.
  assert.equal(normalizeUrl("https://example.com/a|b^c"), "https://example.com/a|b^c");
});

test("rejects a non-numeric port with Python's message", () => {
  assert.throws(
    () => normalizeUrl("https://example.com:bad/book"),
    (error: unknown) =>
      error instanceof InvalidUrlError &&
      error.message === "Port could not be cast to integer value as 'bad'",
  );
});

test("rejects an out-of-range port", () => {
  assert.throws(
    () => normalizeUrl("https://example.com:99999/book"),
    (error: unknown) =>
      error instanceof InvalidUrlError && error.message === "Port out of range 0-65535",
  );
});

test("treats an empty port as absent", () => {
  assert.equal(normalizeUrl("https://example.com:/book"), "https://example.com/book");
});

test("rejects a signed port as uncastable rather than out of range", () => {
  assert.throws(
    () => normalizeUrl("https://example.com:-1/book"),
    (error: unknown) =>
      error instanceof InvalidUrlError &&
      error.message === "Port could not be cast to integer value as '-1'",
  );
});

test("keeps an empty authority so the result stays absolute", () => {
  assert.equal(normalizeUrl("https://@/book"), "https:///book");
});

test("strips control characters and leading whitespace like urlsplit", () => {
  assert.equal(normalizeUrl("  https://example.com/book"), "https://example.com/book");
  assert.equal(normalizeUrl("https://exa\tmple.com/bo\nok"), "https://example.com/book");
});

test("rejects mismatched IPv6 brackets", () => {
  for (const url of ["https://[::1/book", "https://]::1[/book"]) {
    assert.throws(
      () => normalizeUrl(url),
      (error: unknown) => error instanceof InvalidUrlError && error.message === "Invalid IPv6 URL",
    );
  }
});

test("accepts a bracketed IPv6 host and lowercases its zone", () => {
  assert.equal(normalizeUrl("https://[::1]:443/book"), "https://::1/book");
  assert.equal(normalizeUrl("https://[fe80::1%25ETH0]/book"), "https://fe80::1%25eth0/book");
});

test("rejects a bracketed host that is not a valid IPv6 address", () => {
  assert.throws(
    () => normalizeUrl("https://[1.2.3.4]/book"),
    (error: unknown) =>
      error instanceof InvalidUrlError &&
      error.message === "An IPv4 address cannot be in brackets",
  );
  assert.throws(
    () => normalizeUrl("https://[zz]/book"),
    (error: unknown) =>
      error instanceof InvalidUrlError &&
      error.message === "'zz' does not appear to be an IPv4 or IPv6 address",
  );
});

test("rejects a netloc containing characters that decompose unsafely", () => {
  // U+2100 NFKC-normalises to "a/c", which would silently change the host.
  assert.throws(
    () => normalizeUrl("https://exam\u2100ple.com/book"),
    (error: unknown) => error instanceof InvalidUrlError,
  );
});

test("escapes a latin-1 code point in an error message the way Python's repr does", () => {
  assert.throws(
    () => normalizeUrl("https://[\u00a0x]/"),
    (error: unknown) =>
      error instanceof InvalidUrlError &&
      error.message === "'\\xa0x' does not appear to be an IPv4 or IPv6 address",
  );
});

test("escapes a basic-plane code point as \\u", () => {
  assert.throws(
    () => normalizeUrl("https://[a\u200bb]/"),
    (error: unknown) =>
      error instanceof InvalidUrlError &&
      error.message === "'a\\u200bb' does not appear to be an IPv4 or IPv6 address",
  );
});

test("escapes an astral code point as \\U", () => {
  assert.throws(
    () => normalizeUrl("https://[a\u{1d173}b]/"),
    (error: unknown) =>
      error instanceof InvalidUrlError &&
      error.message === "'a\\U0001d173b' does not appear to be an IPv4 or IPv6 address",
  );
});

test("escapes a non-printable code point in the port error message", () => {
  assert.throws(
    () => normalizeUrl("https://example.com:1\u00a02/"),
    (error: unknown) =>
      error instanceof InvalidUrlError &&
      error.message === "Port could not be cast to integer value as '1\\xa02'",
  );
});
