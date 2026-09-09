/** Structural validation of the curated README. */

import { InvalidUrlError, normalizeUrl } from "./normalizeUrl.ts";
import { caseFold, pairKey, splitLines } from "./text.ts";
import { LINK_RE, RESOURCE_RE, type Resource, type ValidationResult } from "./types.ts";

interface CategoryState {
  readonly line: number;
  readonly section: string;
  readonly category: string;
  count: number;
}

/**
 * Parses the README and reports structural problems.
 *
 * Errors are appended in three ordered phases, and callers depend on that
 * ordering: per-line problems in document order, then empty categories in the
 * order the headings were declared, then duplicate titles and URLs in resource
 * order.
 */
export function validateText(text: string): ValidationResult {
  const resources: Resource[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  let section = "";
  let category = "";

  // A Map preserves insertion order the way a Python dict does, and re-setting
  // an existing key keeps its original position. Both matter for error order.
  const categories = new Map<string, CategoryState>();

  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      category = "";
      continue;
    }

    if (line.startsWith("### ")) {
      category = line.slice(4).trim();
      // Re-declaring a heading resets its resource count to zero.
      categories.set(pairKey(section, category), { line: lineNumber, section, category, count: 0 });
      continue;
    }

    if (!LINK_RE.test(line)) {
      continue;
    }

    const match = RESOURCE_RE.exec(line);
    if (match === null) {
      errors.push(`line ${lineNumber}: malformed resource entry`);
      continue;
    }

    if (category === "") {
      errors.push(`line ${lineNumber}: resource is outside a level-three category`);
      continue;
    }

    const rawTitle = match[1] ?? "";
    const url = match[2] ?? "";
    const rawDescription = match[3] ?? "";

    // The punctuation check runs against the raw capture, so a description
    // ending in "." followed by trailing whitespace is still an error. The
    // stored description is trimmed.
    if (!rawDescription.endsWith(".")) {
      errors.push(`line ${lineNumber}: description must end with a period`);
    }

    resources.push({
      line: lineNumber,
      section,
      category,
      title: rawTitle.trim(),
      url,
      description: rawDescription.trim(),
    });

    const state = categories.get(pairKey(section, category));
    if (state !== undefined) {
      state.count += 1;
    }
  }

  for (const state of categories.values()) {
    if (state.count !== 0) {
      continue;
    }
    const location = state.section !== "" ? ` in section '${state.section}'` : "";
    errors.push(
      `line ${state.line}: category '${state.category}'${location} has no resources`,
    );
  }

  const seenTitles = new Map<string, Resource>();
  const seenUrls = new Map<string, Resource>();
  for (const resource of resources) {
    const titleKey = caseFold(resource.title);
    const firstTitle = seenTitles.get(titleKey);
    if (firstTitle !== undefined) {
      errors.push(
        `line ${resource.line}: duplicate title '${resource.title}' ` +
          `(first used on line ${firstTitle.line})`,
      );
    } else {
      seenTitles.set(titleKey, resource);
    }

    let urlKey: string;
    try {
      urlKey = normalizeUrl(resource.url);
    } catch (error) {
      if (!(error instanceof InvalidUrlError)) {
        throw error;
      }
      errors.push(`line ${resource.line}: invalid URL '${resource.url}' (${error.message})`);
      continue;
    }

    const firstUrl = seenUrls.get(urlKey);
    if (firstUrl !== undefined) {
      errors.push(
        `line ${resource.line}: duplicate URL '${resource.url}' ` +
          `(first used on line ${firstUrl.line})`,
      );
    } else {
      seenUrls.set(urlKey, resource);
    }
  }

  return { resources, errors, warnings };
}
