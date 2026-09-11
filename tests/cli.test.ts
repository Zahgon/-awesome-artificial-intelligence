import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = path.join(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "scripts", "validate-readme.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Runs the CLI and captures stdout, stderr and the exit code. */
async function run(...args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENTRY, ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      code: failure.code ?? 1,
    };
  }
}

test("validates the repository README cleanly", async () => {
  const { stdout, stderr, code } = await run("README.md");
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /^Validated \d+ resources with 0 errors and 0 warnings\.\n$/u);
});

test("defaults to README.md when no path is given", async () => {
  const explicit = await run("README.md");
  const implicit = await run();
  assert.deepEqual(implicit, explicit);
});

test("reports structural errors and exits non-zero", async () => {
  const { stdout, stderr, code } = await run("archive/README.md");
  assert.equal(code, 1);
  assert.equal(stderr.match(/^ERROR: /gmu)?.length, 4);
  assert.ok(stderr.includes("category 'Chat' in section 'Tools' has no resources"));
  assert.equal(stdout, "Validated 0 resources with 4 errors and 0 warnings.\n");
});

test("matches the golden output captured from the original Python implementation", async () => {
  const { stdout, stderr, code } = await run("tests/fixtures/stress.md");
  const expected = readFileSync(path.join(ROOT, "tests/fixtures/stress.expected.txt"), "utf8");
  assert.equal(`${stderr}${stdout}exit=${String(code)}\n`, expected);
});

test("prints help and exits zero", async () => {
  const { stdout, code } = await run("--help");
  assert.equal(code, 0);
  assert.ok(
    stdout.startsWith("usage: validate-readme.ts [-h] [--check-links] [--base BASE] [readme]"),
  );
});

test("exits with status 2 on an unknown option", async () => {
  const { stderr, code } = await run("--nonsense");
  assert.equal(code, 2);
  assert.ok(stderr.startsWith("usage: validate-readme.ts"));
  assert.ok(stderr.includes("validate-readme.ts: error:"));
});

test("names the program after argv[0], as argparse does", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bv-prog-"));
  const alias = path.join(dir, "renamed-entry.ts");
  symlinkSync(ENTRY, alias);

  const { stdout } = await execFileAsync(process.execPath, [alias, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.ok(stdout.startsWith("usage: renamed-entry.ts [-h]"));
});

test("exits with status 2 when given extra positional arguments", async () => {
  const { stderr, code } = await run("README.md", "extra.md");
  assert.equal(code, 2);
  assert.ok(stderr.includes("unrecognized arguments: extra.md"));
});

test("fails when the README does not exist", async () => {
  const { code, stderr } = await run("does-not-exist.md");
  assert.notEqual(code, 0);
  assert.ok(stderr.includes("ENOENT"));
});
