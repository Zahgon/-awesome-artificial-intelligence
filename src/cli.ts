/** Command-line entry point for the README validator. */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { checkLinks } from "./checkLinks.ts";
import { validateChurn } from "./validateChurn.ts";
import { validateText } from "./validateText.ts";

const PROGRAM = "validate-readme";
const DEFAULT_README = "README.md";

const USAGE = `usage: ${PROGRAM} [-h] [--check-links] [--base BASE] [readme]`;

const HELP = `${USAGE}

positional arguments:
  readme

options:
  -h, --help     show this help message and exit
  --check-links
  --base BASE    Git revision used to enforce weekly churn limits
`;

interface Options {
  readonly readme: string;
  readonly checkLinks: boolean;
  readonly base: string | undefined;
  readonly help: boolean;
}

type OptionKey = "help" | "checkLinks" | "base";

interface OptionSpec {
  readonly key: OptionKey;
  readonly takesValue: boolean;
  /** How argparse names the option in diagnostics: `'/'.join(option_strings)`. */
  readonly canonical: string;
}

const LONG_OPTIONS = new Map<string, OptionSpec>([
  ["--help", { key: "help", takesValue: false, canonical: "-h/--help" }],
  ["--check-links", { key: "checkLinks", takesValue: false, canonical: "--check-links" }],
  ["--base", { key: "base", takesValue: true, canonical: "--base" }],
]);

const SHORT_OPTIONS = new Map<string, OptionSpec>([
  ["-h", { key: "help", takesValue: false, canonical: "-h/--help" }],
]);

/** Reports a usage error and exits with status 2, as `argparse.error` does. */
function usageError(message: string): never {
  process.stderr.write(`${USAGE}\n${PROGRAM}: error: ${message}\n`);
  process.exit(2);
}

/**
 * Resolves a long option name.
 *
 * argparse accepts any unambiguous prefix of a long option, so `--check` and
 * `--ba` are valid spellings of `--check-links` and `--base`. Returning `null`
 * marks the token as unrecognised rather than failing immediately, because
 * argparse reports every unrecognised argument together at the end.
 */
function resolveLong(name: string): OptionSpec | null {
  const exact = LONG_OPTIONS.get(name);
  if (exact !== undefined) {
    return exact;
  }
  const matches = [...LONG_OPTIONS.keys()].filter((candidate) => candidate.startsWith(name));
  if (matches.length > 1) {
    usageError(`ambiguous option: ${name} could match ${matches.join(", ")}`);
  }
  const sole = matches[0];
  return sole === undefined ? null : (LONG_OPTIONS.get(sole) ?? null);
}

/** Parses argv, exiting with status 2 on a usage error as argparse does. */
function parseOptions(argv: readonly string[]): Options {
  let checkLinks = false;
  let base: string | undefined;
  let readme: string | undefined;
  const unrecognized: string[] = [];
  let optionsEnded = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (optionsEnded || token === "-" || !token.startsWith("-")) {
      if (readme === undefined) {
        readme = token;
      } else {
        unrecognized.push(token);
      }
      continue;
    }

    if (token === "--") {
      optionsEnded = true;
      continue;
    }

    const isLong = token.startsWith("--");
    const separator = isLong ? token.indexOf("=") : -1;
    const name = separator === -1 ? token : token.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : token.slice(separator + 1);
    const spec = isLong ? resolveLong(name) : (SHORT_OPTIONS.get(name) ?? null);

    if (spec === null) {
      unrecognized.push(token);
      continue;
    }

    if (!spec.takesValue) {
      if (inlineValue !== undefined) {
        usageError(`argument ${spec.canonical}: ignored explicit argument '${inlineValue}'`);
      }
      if (spec.key === "help") {
        // argparse acts on -h the moment it is consumed, so nothing after it
        // is parsed and no later error can pre-empt the help output.
        return { readme: readme ?? DEFAULT_README, checkLinks, base, help: true };
      }
      checkLinks = true;
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined) {
      usageError(`argument ${spec.canonical}: expected one argument`);
    }
    base = value;
  }

  if (unrecognized.length > 0) {
    usageError(`unrecognized arguments: ${unrecognized.join(" ")}`);
  }

  return { readme: readme ?? DEFAULT_README, checkLinks, base, help: false };
}

/** Converts a filesystem path to the POSIX form git expects. */
function toGitPath(value: string): string {
  return path.posix.normalize(value.split(path.sep).join("/"));
}

/** Reads a file at a given git revision, throwing if the revision is unknown. */
function readAtRevision(revision: string, filePath: string): string {
  return execFileSync("git", ["show", `${revision}:${toGitPath(filePath)}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Validates the README and reports findings.
 *
 * Warnings and errors go to stderr, the summary to stdout, and the return value
 * becomes the process exit code.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const options = parseOptions(argv);

  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const text = readFileSync(options.readme, "utf8");
  const { resources, errors, warnings } = validateText(text);

  if (options.checkLinks) {
    const linkFindings = await checkLinks(resources);
    errors.push(...linkFindings.errors);
    warnings.push(...linkFindings.warnings);
  }

  if (options.base !== undefined) {
    const baseText = readAtRevision(options.base, options.readme);
    errors.push(...validateChurn(baseText, text));
  }

  for (const warning of warnings) {
    process.stderr.write(`WARNING: ${warning}\n`);
  }
  for (const error of errors) {
    process.stderr.write(`ERROR: ${error}\n`);
  }
  process.stdout.write(
    `Validated ${resources.length} resources with ${errors.length} errors ` +
      `and ${warnings.length} warnings.\n`,
  );

  return errors.length > 0 ? 1 : 0;
}
