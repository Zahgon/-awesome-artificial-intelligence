/** Shared types and constants for the curated README validator. */

/** Matches a well-formed resource entry: `- [Title](https://url): Description.` */
export const RESOURCE_RE = /^- \[([^\]]+)\]\((https:\/\/[^)\s]+)\): (.+)$/u;

/** Matches any list item that looks like it intends to be a resource entry. */
export const LINK_RE = /^- \[/u;

export const USER_AGENT = "awesome-ai-resource-validator/1.0";

/** A single curated resource, mirroring the frozen Python dataclass. */
export interface Resource {
  readonly line: number;
  readonly section: string;
  readonly category: string;
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

export type Severity = "error" | "warning";

/** A classified problem: severity plus the human-readable message. */
export type Finding = readonly [Severity, string];

export interface ValidationResult {
  readonly resources: Resource[];
  readonly errors: string[];
  readonly warnings: string[];
}

export interface LinkCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
}
