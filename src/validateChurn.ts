/** Weekly churn limits applied to curated README changes. */

import { caseFold } from "./text.ts";
import { validateText } from "./validateText.ts";
import type { Resource } from "./types.ts";

const MAX_CHANGED_ENTRIES = 6;
const MAX_NET_ADDITIONS = 3;
const MAX_FOUNDATIONAL_CHANGES = 1;

/** The section whose entries count as foundational. */
const FOUNDATIONAL_SECTION = "learn";

/** Indexes resources by case-folded title; later duplicates win. */
function resourceMap(resources: readonly Resource[]): Map<string, Resource> {
  const byTitle = new Map<string, Resource>();
  for (const resource of resources) {
    byTitle.set(caseFold(resource.title), resource);
  }
  return byTitle;
}

/**
 * Builds a comparable signature for an entry.
 *
 * Returns `null` for a missing entry so that additions and removals always
 * compare as changed.
 */
function signature(resource: Resource | undefined): string | null {
  if (resource === undefined) {
    return null;
  }
  return JSON.stringify([resource.section, resource.category, resource.url, resource.description]);
}

/**
 * Compares two README revisions and reports churn-limit violations.
 *
 * An entry counts as foundational when *either* revision places it in the
 * Learn section, so moving an entry into or out of Learn is caught.
 */
export function validateChurn(baseText: string, currentText: string): string[] {
  const base = validateText(baseText);
  const current = validateText(currentText);
  if (base.errors.length > 0 || current.errors.length > 0) {
    return ["cannot calculate churn until both README versions are structurally valid"];
  }

  const baseByTitle = resourceMap(base.resources);
  const currentByTitle = resourceMap(current.resources);

  const titles = new Set([...baseByTitle.keys(), ...currentByTitle.keys()]);
  const changedTitles = [...titles].filter(
    (title) => signature(baseByTitle.get(title)) !== signature(currentByTitle.get(title)),
  );

  const foundationalChanges = changedTitles.filter((title) =>
    [baseByTitle.get(title), currentByTitle.get(title)].some(
      (resource) => resource !== undefined && caseFold(resource.section) === FOUNDATIONAL_SECTION,
    ),
  ).length;

  const netAdditions = current.resources.length - base.resources.length;

  const errors: string[] = [];
  if (changedTitles.length > MAX_CHANGED_ENTRIES) {
    errors.push(
      `churn limit exceeded: ${changedTitles.length} resource entries changed ` +
        `(maximum ${MAX_CHANGED_ENTRIES})`,
    );
  }
  if (netAdditions > MAX_NET_ADDITIONS) {
    errors.push(
      `churn limit exceeded: ${netAdditions} net entries added (maximum ${MAX_NET_ADDITIONS})`,
    );
  }
  if (foundationalChanges > MAX_FOUNDATIONAL_CHANGES) {
    errors.push(
      `churn limit exceeded: ${foundationalChanges} foundational entries changed ` +
        `(maximum ${MAX_FOUNDATIONAL_CHANGES})`,
    );
  }
  return errors;
}
