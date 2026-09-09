import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyException, classifyStatus } from "../src/classify.ts";

/** Builds the shape Node's fetch produces: a TypeError wrapping the real cause. */
function fetchFailure(message: string, code: string): Error {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(message), { code }),
  });
}

test("validate_readme::test_link_status_classification - classifies HTTP status codes", () => {
  assert.equal(classifyStatus(404, "https://example.com")?.[0], "error");
  assert.equal(classifyStatus(400, "https://example.com")?.[0], "error");
  assert.equal(classifyStatus(451, "https://example.com")?.[0], "error");
  assert.equal(classifyStatus(403, "https://example.com")?.[0], "warning");
  assert.equal(classifyStatus(408, "https://example.com")?.[0], "warning");
  assert.equal(classifyStatus(503, "https://example.com")?.[0], "warning");
  assert.equal(classifyStatus(200, "https://example.com"), null);
});

test("classifies status-code boundaries", () => {
  assert.equal(classifyStatus(399, "https://example.com"), null);
  assert.equal(classifyStatus(410, "https://example.com")?.[0], "error");
  assert.equal(classifyStatus(429, "https://example.com")?.[0], "warning");
  assert.equal(classifyStatus(499, "https://example.com")?.[0], "error");
  assert.equal(classifyStatus(500, "https://example.com")?.[0], "warning");
  assert.equal(classifyStatus(599, "https://example.com")?.[0], "warning");
});

test("uses the documented status messages", () => {
  assert.deepEqual(classifyStatus(404, "https://example.com"), [
    "error",
    "broken link (404): https://example.com",
  ]);
  assert.deepEqual(classifyStatus(403, "https://example.com"), [
    "warning",
    "link check blocked (403): https://example.com",
  ]);
  assert.deepEqual(classifyStatus(408, "https://example.com"), [
    "warning",
    "link check timed out (408): https://example.com",
  ]);
  assert.deepEqual(classifyStatus(503, "https://example.com"), [
    "warning",
    "remote server error (503): https://example.com",
  ]);
});

test("validate_readme::test_link_exception_classification - classifies transport failures", () => {
  const url = "https://example.invalid";
  const dnsError = fetchFailure("getaddrinfo ENOTFOUND example.invalid", "ENOTFOUND");
  const tlsError = fetchFailure("bad certificate", "ERR_TLS_CERT_ALTNAME_INVALID");
  const timeout = fetchFailure("timed out", "UND_ERR_HEADERS_TIMEOUT");

  assert.equal(classifyException(dnsError, url)[0], "error");
  assert.equal(classifyException(tlsError, url)[0], "error");
  assert.equal(classifyException(timeout, url)[0], "warning");
});

test("treats an abort as a timeout warning", () => {
  const url = "https://example.com";
  const aborted = new DOMException("The operation was timed out", "TimeoutError");
  const finding = classifyException(aborted, url);
  assert.equal(finding[0], "warning");
  assert.ok(finding[1].startsWith("link check timed out: https://example.com ("));
});

test("treats a protocol interruption as a warning", () => {
  const finding = classifyException(
    fetchFailure("socket hang up", "ECONNRESET"),
    "https://example.com",
  );
  assert.deepEqual(finding, [
    "warning",
    "link check interrupted: https://example.com (socket hang up)",
  ]);
});

test("treats a refused connection as an unreachable error", () => {
  const finding = classifyException(
    fetchFailure("connect ECONNREFUSED 127.0.0.1:1", "ECONNREFUSED"),
    "https://example.com",
  );
  assert.deepEqual(finding, [
    "error",
    "unreachable link: https://example.com (connect ECONNREFUSED 127.0.0.1:1)",
  ]);
});

test("reports the innermost message as the reason", () => {
  const finding = classifyException(fetchFailure("root cause", "ENOTFOUND"), "https://example.com");
  assert.equal(finding[1], "unreachable link: https://example.com (root cause)");
});

test("survives a cause cycle and a non-error value", () => {
  const outer: { message: string; cause?: unknown } = { message: "outer" };
  outer.cause = outer;
  assert.equal(classifyException(outer, "https://example.com")[0], "error");
  assert.equal(
    classifyException("plain string", "https://example.com")[1],
    "unreachable link: https://example.com (plain string)",
  );
});
