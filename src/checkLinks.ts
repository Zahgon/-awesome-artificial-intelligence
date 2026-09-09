/** Network reachability checks for curated resource URLs. */

import { classifyException, classifyStatus } from "./classify.ts";
import { sortByCodePoint } from "./text.ts";
import { USER_AGENT, type Finding, type LinkCheckResult, type Resource } from "./types.ts";

const REQUEST_TIMEOUT_MS = 15_000;

/** Matches `ThreadPoolExecutor(max_workers=8)` in the original. */
const MAX_CONCURRENCY = 8;

/** Status codes that mean "this server dislikes HEAD", prompting a GET retry. */
const HEAD_UNSUPPORTED = new Set([405, 501]);

/**
 * Issues a single request and returns the final status code.
 *
 * The response body is discarded as soon as the headers arrive; leaving it
 * unread would keep sockets open across a run of several hundred links.
 */
async function requestStatus(url: string, method: "HEAD" | "GET"): Promise<number> {
  const response = await fetch(url, {
    method,
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  try {
    await response.body?.cancel();
  } catch {
    // Discarding the body is best-effort and never changes the verdict.
  }
  return response.status;
}

/**
 * Checks one resource URL, returning `null` when the link is healthy.
 *
 * Tries HEAD first and falls back to GET only when the server reports that
 * HEAD is unsupported. A transport failure during the HEAD is returned
 * immediately without a GET retry, matching the original control flow.
 */
export async function checkLink(resource: Resource): Promise<Finding | null> {
  let status: number;
  try {
    status = await requestStatus(resource.url, "HEAD");
  } catch (error) {
    return classifyException(error, resource.url);
  }

  if (!HEAD_UNSUPPORTED.has(status)) {
    return classifyStatus(status, resource.url);
  }

  try {
    status = await requestStatus(resource.url, "GET");
  } catch (error) {
    return classifyException(error, resource.url);
  }
  return classifyStatus(status, resource.url);
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;

  async function runner(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await worker(item);
    }
  }

  const runnerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: runnerCount }, runner));
  return results;
}

/**
 * Checks every resource link and returns sorted error and warning messages.
 */
export async function checkLinks(resources: readonly Resource[]): Promise<LinkCheckResult> {
  const findings = await mapWithConcurrency(resources, MAX_CONCURRENCY, checkLink);

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const finding of findings) {
    if (finding === null || finding === undefined) {
      continue;
    }
    const [severity, message] = finding;
    if (severity === "error") {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  return { errors: sortByCodePoint(errors), warnings: sortByCodePoint(warnings) };
}
