import assert from "node:assert/strict";
import { test } from "node:test";

import { caseFold, sortByCodePoint, splitLines } from "../src/text.ts";

test("splits on the same boundaries as Python's str.splitlines", () => {
  assert.deepEqual(splitLines("a\nb\nc"), ["a", "b", "c"]);
  assert.deepEqual(splitLines("a\r\nb"), ["a", "b"]);
  assert.deepEqual(splitLines("a\rb"), ["a", "b"]);
  assert.deepEqual(splitLines("a\u2028b"), ["a", "b"]);
  assert.deepEqual(splitLines("a\x0bb"), ["a", "b"]);
});

test("does not emit a trailing empty line", () => {
  assert.deepEqual(splitLines("a\n"), ["a"]);
  assert.deepEqual(splitLines("a\r\n"), ["a"]);
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("\n"), [""]);
  assert.deepEqual(splitLines("a\n\n"), ["a", ""]);
});

test("case-folds for case-insensitive comparison", () => {
  assert.equal(caseFold("A Book"), "a book");
  assert.equal(caseFold("ÄÖÜ"), "äöü");
});

test("case-folds where toLowerCase() is not enough", () => {
  // Full case folding expands these; the simple lowercase mapping does not.
  // Differential fuzzing against Python caught "Straße" and "STRASSE" failing
  // to collide as duplicate titles, so each family is pinned here.
  assert.equal(caseFold("Straße"), "strasse");
  assert.equal(caseFold("STRASSE"), "strasse");
  assert.equal(caseFold("ﬀ"), "ff");
  assert.equal(caseFold("ſmall"), "small");
  assert.equal(caseFold("µ"), "μ"); // micro sign folds to Greek mu
  assert.equal(caseFold("ŉ"), "ʼn");

  // Cherokee folds toward uppercase, the opposite direction to toLowerCase().
  assert.equal(caseFold("ꭰ"), "Ꭰ");
  assert.equal(caseFold("Ꭰ"), "Ꭰ");
  assert.notEqual(caseFold("Ꭰ"), "Ꭰ".toLowerCase());
});

test("sorts by code point rather than by locale", () => {
  // A locale-aware sort would interleave these; Python's sorted() does not.
  assert.deepEqual(sortByCodePoint(["b", "A", "a", "B"]), ["A", "B", "a", "b"]);
  assert.deepEqual(sortByCodePoint(["line 20:", "line 3:"]), ["line 20:", "line 3:"]);
});
