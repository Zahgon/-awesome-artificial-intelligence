import assert from "node:assert/strict";
import { test } from "node:test";

import { validateText } from "../src/validateText.ts";

const VALID = `# List

### Books

- [A Book](https://example.com/book): A useful book.
`;

test("validate_readme::test_valid_resource - accepts a well-formed resource", () => {
  const { resources, errors, warnings } = validateText(VALID);
  assert.equal(resources.length, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(resources[0], {
    line: 5,
    section: "",
    category: "Books",
    title: "A Book",
    url: "https://example.com/book",
    description: "A useful book.",
  });
});

test("rejects a malformed resource", () => {
  const { errors } = validateText("### Books\n\n- [A Book](http://example.com): No TLS.\n");
  assert.ok(errors[0]?.includes("malformed resource entry"));
});

test("validate_readme::test_duplicate_title_and_normalized_url - detects duplicate titles and normalised URLs", () => {
  const text = `### Books

- [A Book](https://EXAMPLE.com/book/): First entry.
- [a book](https://example.com/book#section): Second entry.
`;
  const { errors } = validateText(text);
  assert.ok(errors.some((error) => error.includes("duplicate title")));
  assert.ok(errors.some((error) => error.includes("duplicate URL")));
});

test("rejects an empty category", () => {
  const { errors } = validateText("### Books\n\nSome prose.\n");
  assert.ok(errors[0]?.includes("category 'Books' has no resources"));
});

test("a level-two heading resets the current category", () => {
  const text = `${VALID}\n## Contributing\n\n- [A Tool](https://example.com/tool): A tool.\n`;
  const { errors } = validateText(text);
  assert.ok(errors.some((error) => error.includes("outside a level-three category")));
});

test("validate_readme::test_same_category_name_in_different_sections - tracks identically named categories in different sections", () => {
  const text = `## First

### Tools

## Second

### Tools

- [A Tool](https://example.com/tool): A tool.
`;
  const { errors } = validateText(text);
  assert.ok(errors.some((error) => error.includes("section 'First'")));
  assert.ok(!errors.some((error) => error.includes("section 'Second'")));
});

test("requires a description to end with a period", () => {
  const { errors } = validateText(
    "### Books\n\n- [A Book](https://example.com/book): Missing punctuation\n",
  );
  assert.ok(errors[0]?.includes("description must end with a period"));
});

test("reports an invalid URL as an error", () => {
  const { errors } = validateText(
    "### Books\n\n- [A Book](https://example.com:bad/book): Invalid port.\n",
  );
  assert.ok(errors[0]?.includes("invalid URL"));
});

test("the period check uses the untrimmed description", () => {
  const { errors, resources } = validateText(
    "### Books\n\n- [A Book](https://example.com/book): Trailing space. \n",
  );
  assert.ok(errors[0]?.includes("description must end with a period"));
  assert.equal(resources[0]?.description, "Trailing space.");
});

test("emits errors in scan, empty-category, then duplicate order", () => {
  const text = `## Learn

### Empty

### Books

- [A Book](https://example.com/one): Fine.
- [A Book](https://example.com/two): Duplicate title.
- [Third](https://example.com/three): No period here
`;
  const { errors } = validateText(text);
  assert.deepEqual(errors, [
    "line 9: description must end with a period",
    "line 3: category 'Empty' in section 'Learn' has no resources",
    "line 8: duplicate title 'A Book' (first used on line 7)",
  ]);
});

test("a re-declared heading resets its resource count", () => {
  const text = `### Books

- [A Book](https://example.com/book): A book.

### Books
`;
  const { errors } = validateText(text);
  assert.deepEqual(errors, ["line 5: category 'Books' has no resources"]);
});

test("a list item that is not a link is ignored entirely", () => {
  const { errors, resources } = validateText(
    "### Books\n\n- plain bullet\n- [A Book](https://example.com/book): A book.\n",
  );
  assert.deepEqual(errors, []);
  assert.equal(resources.length, 1);
});

test("handles an empty document", () => {
  const { resources, errors, warnings } = validateText("");
  assert.deepEqual(resources, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});
