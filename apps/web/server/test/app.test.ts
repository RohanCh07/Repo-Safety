import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryBlobs } from "../src/blobs.js";
import { processScan } from "../src/processor.js";
import { InlineQueue } from "../src/queue.js";
import { MemoryStore } from "../src/store.js";
import { buildZip } from "../../../../packages/core/test/helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SHA = "a".repeat(40);

const trapZip = buildZip([
  { name: "take-home-main/README.md", data: "# Task\n" },
  { name: "take-home-main/.vscode/tasks.json", data: JSON.stringify({ tasks: [{ label: "x", command: "echo hello", runOptions: { runOn: "folderOpen" } }] }, null, 2) },
]);

async function setup(opts: { fetch?: (url: string) => Promise<Response> } = {}) {
  const store = new MemoryStore();
  const blobs = new MemoryBlobs();
  let downloads = 0;
  const fetch =
    opts.fetch ??
    (async (url: string) => {
      if (url.startsWith("https://api.github.com/")) return new Response(SHA, { status: 200 });
      if (url.startsWith("https://codeload.github.com/")) {
        downloads++;
        return new Response(new Uint8Array(trapZip), { status: 200, headers: { "content-length": String(trapZip.length) } });
      }
      return new Response(null, { status: 404 });
    });
  const queue = new InlineQueue((job) => processScan(job, { store, blobs, maxDownloadBytes: 10_000_000, fetch }));
  const app = await buildApp({ store, blobs, queue, fetch, maxUploadBytes: 1_000_000, rateLimitPerMinute: 1000, publicDir: path.resolve(here, "../../frontend/public") });
  apps.push(app);
  return { app, store, blobs, queue, downloads: () => downloads };
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function multipart(fileName: string, data: Buffer) {
  const boundary = "----repo-safety-test";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("web API", () => {
  it("scans a repo link end to end and caches by commit", async () => {
    const { app, queue, downloads } = await setup();
    const first = await app.inject({ method: "POST", url: "/api/scans", payload: { url: "https://github.com/acme/take-home" } });
    expect(first.statusCode).toBe(202);
    await queue.idle();

    const scan = (await app.inject({ url: `/api/scans/${first.json().id}` })).json();
    expect(scan.status).toBe("done");
    expect(scan.target).toBe("github.com/acme/take-home");
    expect(scan.report.verdict).toBe("dangerous");
    expect(scan.report.findings[0]).toMatchObject({ file: ".vscode/tasks.json", ruleId: "vscode-autorun-task" });

    const again = await app.inject({ method: "POST", url: "/api/scans", payload: { url: "github.com/acme/take-home" } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: first.json().id, cached: true, status: "done" });
    expect(downloads()).toBe(1);
  });

  it("scans an uploaded ZIP and deletes the upload afterwards", async () => {
    const { app, queue, blobs } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/scans/upload", ...multipart("take-home.zip", trapZip) });
    expect(res.statusCode).toBe(202);
    await queue.idle();
    const scan = (await app.inject({ url: `/api/scans/${res.json().id}` })).json();
    expect(scan).toMatchObject({ status: "done", target: "take-home.zip" });
    expect(scan.report.verdict).toBe("dangerous");
    expect(blobs.size).toBe(0);
  });

  it("rejects a zip-slip upload safely", async () => {
    const { app, queue } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/scans/upload", ...multipart("evil.zip", buildZip([{ name: "../../etc/evil", data: "x" }])) });
    await queue.idle();
    const scan = (await app.inject({ url: `/api/scans/${res.json().id}` })).json();
    expect(scan.status).toBe("failed");
    expect(scan.error).toMatch(/rejected/i);
  });

  it("rejects non-zip uploads and oversized uploads", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/scans/upload", ...multipart("notes.txt", Buffer.from("hi")) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/scans/upload", ...multipart("big.zip", Buffer.alloc(2_000_000)) })).statusCode).toBe(413);
  });

  it("refuses links to other hosts", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/scans", payload: { url: "https://internal.example/a/b" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Only https links/);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/api/scans/00000000-0000-0000-0000-000000000000" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/scans/../../etc" })).statusCode).toBe(404);
  });

  it("serves a badge summary for the browser extension", async () => {
    const { app, queue } = await setup();
    const first = (await app.inject({ url: "/api/repos/github/acme/take-home" })).json();
    expect(first.status).toBe("queued");
    await queue.idle();
    const second = (await app.inject({ url: "/api/repos/github/acme/take-home" })).json();
    expect(second).toMatchObject({ status: "done", verdict: "dangerous", reportPath: `/r/${first.id}` });
  });

  it("serves the frontend with a strict content security policy", async () => {
    const { app } = await setup();
    const home = await app.inject({ url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("Is this repo safe to open?");
    expect(home.headers["content-security-policy"]).toContain("script-src 'self'");
    const report = await app.inject({ url: "/r/abc" });
    expect(report.body).toContain("report.js");
  });

  it("rate limits scan requests", async () => {
    const store = new MemoryStore();
    const blobs = new MemoryBlobs();
    const queue = new InlineQueue(async () => {});
    const app = await buildApp({ store, blobs, queue, maxUploadBytes: 1000, rateLimitPerMinute: 2, fetch: async () => new Response(SHA) });
    apps.push(app);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.inject({ method: "POST", url: "/api/scans", payload: { url: "acme/x" } })).statusCode);
    expect(codes).toEqual([202, 202, 429]);
  });
});
