import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { checkLink, checkLinks } from "../src/checkLinks.ts";
import type { Resource } from "../src/types.ts";

let server: Server;
let origin: string;
const methodLog: string[] = [];

before(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const method = request.method ?? "GET";
    methodLog.push(`${method} ${path}`);

    switch (path) {
      case "/ok":
        response.writeHead(200);
        break;
      case "/missing":
        response.writeHead(404);
        break;
      case "/blocked":
        response.writeHead(403);
        break;
      case "/overloaded":
        response.writeHead(503);
        break;
      case "/head-unsupported":
        response.writeHead(method === "HEAD" ? 405 : 200);
        break;
      case "/head-not-implemented":
        // HEAD is rejected, and the GET retry then reveals a genuine 404.
        response.writeHead(method === "HEAD" ? 501 : 404);
        break;
      case "/redirect":
        response.writeHead(302, { location: "/ok" });
        break;
      default:
        response.writeHead(200);
        break;
    }
    response.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

function resource(url: string, line: number): Resource {
  return {
    line,
    section: "Learn",
    category: "Books",
    title: `Title ${String(line)}`,
    url,
    description: "A description.",
  };
}

test("a healthy link produces no finding", async () => {
  assert.equal(await checkLink(resource(`${origin}/ok`, 1)), null);
});

test("a 404 is an error and a 403 is a warning", async () => {
  assert.equal((await checkLink(resource(`${origin}/missing`, 1)))?.[0], "error");
  assert.equal((await checkLink(resource(`${origin}/blocked`, 2)))?.[0], "warning");
  assert.equal((await checkLink(resource(`${origin}/overloaded`, 3)))?.[0], "warning");
});

test("retries with GET when HEAD is rejected as 405", async () => {
  methodLog.length = 0;
  assert.equal(await checkLink(resource(`${origin}/head-unsupported`, 1)), null);
  assert.deepEqual(methodLog, ["HEAD /head-unsupported", "GET /head-unsupported"]);
});

test("reports the status from the GET retry, not the 501 from HEAD", async () => {
  const finding = await checkLink(resource(`${origin}/head-not-implemented`, 1));
  assert.equal(finding?.[0], "error");
  assert.ok(finding?.[1].includes("(404)"));
});

test("follows redirects", async () => {
  assert.equal(await checkLink(resource(`${origin}/redirect`, 1)), null);
});

test("a refused connection is an unreachable error", async () => {
  // Port 1 on loopback is reserved and never listening.
  const finding = await checkLink(resource("http://127.0.0.1:1/nope", 1));
  assert.equal(finding?.[0], "error");
  assert.ok(finding?.[1].startsWith("unreachable link: http://127.0.0.1:1/nope ("));
});

test("splits findings into errors and warnings, sorted", async () => {
  const resources = [
    resource(`${origin}/missing`, 20),
    resource(`${origin}/ok`, 21),
    resource(`${origin}/blocked`, 22),
    resource(`${origin}/missing`, 3),
  ];
  const { errors, warnings } = await checkLinks(resources);

  // Messages carry no line prefix, so the two 404s are indistinguishable.
  assert.deepEqual(errors, [
    `broken link (404): ${origin}/missing`,
    `broken link (404): ${origin}/missing`,
  ]);
  assert.deepEqual(warnings, [`link check blocked (403): ${origin}/blocked`]);
});

test("checks more links than the concurrency limit without losing any", async () => {
  const resources = Array.from({ length: 25 }, (_unused, index) =>
    resource(`${origin}/missing?i=${String(index)}`, index + 1),
  );
  const { errors, warnings } = await checkLinks(resources);
  assert.equal(errors.length, 25);
  assert.deepEqual(warnings, []);
});

test("an empty resource list needs no requests", async () => {
  assert.deepEqual(await checkLinks([]), { errors: [], warnings: [] });
});
