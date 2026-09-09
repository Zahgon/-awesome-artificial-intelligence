import assert from "node:assert/strict";
import { test } from "node:test";

import { validateChurn } from "../src/validateChurn.ts";

/**
 * Replaces the first `count` occurrences of `search`.
 *
 * `String.prototype.replaceAll` has no count parameter, so this stands in for
 * Python's `str.replace(old, new, count)`.
 */
function replaceFirstN(text: string, search: string, replacement: string, count: number): string {
  let result = "";
  let rest = text;
  for (let done = 0; done < count; done += 1) {
    const index = rest.indexOf(search);
    if (index === -1) {
      break;
    }
    result += rest.slice(0, index) + replacement;
    rest = rest.slice(index + search.length);
  }
  return result + rest;
}

function buildBase(): string {
  const tools = Array.from(
    { length: 6 },
    (_unused, index) => `- [Tool ${index}](https://example.com/${index}): A tool.`,
  ).join("\n");
  return (
    "## Learn\n\n### Books\n\n- [Book](https://example.com/book): A book.\n\n" +
    "## Build\n\n### Tools\n\n" +
    tools
  );
}

test("allows changes within every churn limit", () => {
  const base = buildBase();
  const acceptable = replaceFirstN(base, "A tool.", "A better tool.", 6);
  assert.deepEqual(validateChurn(base, acceptable), []);
});

test("rejects too many changed entries", () => {
  const base = buildBase();
  const acceptable = replaceFirstN(base, "A tool.", "A better tool.", 6);
  const tooMany = `${acceptable}\n- [Tool 7](https://example.com/7): A tool.\n`;
  assert.ok(validateChurn(base, tooMany).some((error) => error.includes("resource entries")));
});

test("rejects too many net additions", () => {
  const base = buildBase();
  const additions = Array.from(
    { length: 4 },
    (_unused, index) => `- [New ${index}](https://example.com/new-${index}): A tool.`,
  ).join("\n");
  const fourAdditions = `${base}\n${additions}`;
  assert.ok(validateChurn(base, fourAdditions).some((error) => error.includes("net entries")));
});

test("rejects too many foundational changes", () => {
  const base = buildBase();
  const twoFoundations = base
    .replaceAll("A book.", "A revised book.")
    .replaceAll("\n## Build", "\n- [Second Book](https://example.com/book-2): A book.\n\n## Build");
  assert.ok(
    validateChurn(base, twoFoundations).some((error) => error.includes("foundational entries")),
  );
});

test("counts an entry moved into the Learn section as foundational", () => {
  const base = buildBase();
  const moved = base
    .replaceAll("A book.", "A revised book.")
    .replaceAll(
      "\n## Build\n\n### Tools\n\n- [Tool 0](https://example.com/0): A tool.",
      "\n- [Tool 0](https://example.com/0): A tool.\n\n## Build\n\n### Tools",
    );
  assert.ok(validateChurn(base, moved).some((error) => error.includes("foundational entries")));
});

test("refuses to measure churn against a structurally invalid revision", () => {
  const base = buildBase();
  const broken = `${base}\n\n### Orphan Category\n`;
  assert.deepEqual(validateChurn(base, broken), [
    "cannot calculate churn until both README versions are structurally valid",
  ]);
  assert.deepEqual(validateChurn(broken, base), [
    "cannot calculate churn until both README versions are structurally valid",
  ]);
});

test("reports an unchanged revision as no churn", () => {
  const base = buildBase();
  assert.deepEqual(validateChurn(base, base), []);
});

test("uses the documented limit messages", () => {
  const base = buildBase();
  const additions = Array.from(
    { length: 4 },
    (_unused, index) => `- [New ${index}](https://example.com/new-${index}): A tool.`,
  ).join("\n");
  assert.deepEqual(validateChurn(base, `${base}\n${additions}`), [
    "churn limit exceeded: 4 net entries added (maximum 3)",
  ]);
});
