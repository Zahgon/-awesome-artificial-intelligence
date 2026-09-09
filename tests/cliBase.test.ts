import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = path.join(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "scripts", "validate-readme.ts");

const BASE_README = `# List

### Books

- [A Book](https://example.com/book): A useful book.
`;

const CHANGED_README = `# List

### Books

- [A Book](https://example.com/book): A useful book.
- [Another Book](https://example.com/second): A second useful book.
`;

const repos: string[] = [];

after(() => {
  for (const repo of repos) {
    rmSync(repo, { recursive: true, force: true });
  }
});

/** Creates a throwaway git repository with `readmePath` committed at HEAD. */
function makeRepo(readmePath: string, committed: string): string {
  const repo = mkdtempSync(path.join(tmpdir(), "validate-readme-"));
  repos.push(repo);
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  };
  git("init", "-q");
  git("config", "user.email", "qc@example.com");
  git("config", "user.name", "QC");
  git("config", "commit.gpgsign", "false");
  mkdirSync(path.dirname(path.join(repo, readmePath)), { recursive: true });
  writeFileSync(path.join(repo, readmePath), committed);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return repo;
}

async function run(cwd: string, ...args: readonly string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENTRY, ...args], {
      cwd,
      encoding: "utf8",
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.code ?? 1 };
  }
}

test("--base reads the committed README and reports no churn when nothing changed", async () => {
  const repo = makeRepo("README.md", BASE_README);
  const { stdout, code } = await run(repo, "--base", "HEAD", "README.md");
  assert.equal(code, 0);
  assert.match(stdout, /Validated 1 resources with 0 errors/u);
});

test("--base measures churn against the committed revision", async () => {
  const repo = makeRepo("README.md", BASE_README);
  writeFileSync(path.join(repo, "README.md"), CHANGED_README);
  const { stdout, code } = await run(repo, "--base", "HEAD", "README.md");
  assert.equal(code, 0);
  assert.match(stdout, /Validated 2 resources with 0 errors/u);
});

test("--base resolves a nested readme path through git's forward-slash syntax", async () => {
  const nested = path.join("docs", "guides", "README.md");
  const repo = makeRepo(nested, BASE_README);
  const { stdout, code } = await run(repo, "--base", "HEAD", nested);
  assert.equal(code, 0);
  assert.match(stdout, /Validated 1 resources with 0 errors/u);
});

test("--base fails when the revision does not exist", async () => {
  const repo = makeRepo("README.md", BASE_README);
  const { code, stderr } = await run(repo, "--base", "no-such-revision", "README.md");
  assert.notEqual(code, 0);
  assert.ok(stderr.length > 0);
});
