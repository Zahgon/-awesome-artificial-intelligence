/**
 * String helpers that reproduce Python semantics the JavaScript standard
 * library does not match out of the box.
 */

/**
 * Every boundary recognised by Python's `str.splitlines()`.
 *
 * `String.prototype.split("\n")` is not a substitute: it ignores `\r`, `\v`,
 * `\f`, `\x1c`-`\x1e`, `\x85`, `\u2028` and `\u2029`. Line numbers derived from
 * this split appear in every diagnostic, so the boundary set must match.
 */
const LINE_BOUNDARY = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/u;

/**
 * Port of Python's `str.splitlines()`.
 *
 * Unlike `split()`, a trailing line boundary does not produce a final empty
 * element: `"a\n"` yields `["a"]`, and `""` yields `[]`.
 */
export function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  const lines = text.split(LINE_BOUNDARY);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export { caseFold } from "./caseFold.ts";

/**
 * Compares strings by Unicode code point, matching Python's `sorted()`.
 *
 * The default JavaScript comparison orders by UTF-16 code unit, which places
 * astral-plane characters before U+E000-U+FFFF instead of after them.
 */
export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const a = leftPoints[index] ?? 0;
    const b = rightPoints[index] ?? 0;
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return leftPoints.length - rightPoints.length;
}

/** Sorts a copy of `values` by code point, matching Python's `sorted()`. */
export function sortByCodePoint(values: readonly string[]): string[] {
  return [...values].sort(compareCodePoints);
}

/** Builds a value-equality key for a `(section, category)` pair. */
export function pairKey(first: string, second: string): string {
  return JSON.stringify([first, second]);
}
