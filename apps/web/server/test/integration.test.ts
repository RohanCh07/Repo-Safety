import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { VERSION } from "@repo-safety/core";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryBlobs } from "../src/blobs.js";
import { processScan } from "../src/processor.js";
import { BullQueue, QUEUE_NAME, redisConnection } from "../src/queue.js";
import { PgStore } from "../src/store.js";
import type { ScanRecord } from "../src/types.js";
import { buildZip } from "../../../../packages/core/test/helpers.js";

// These run only when real services are available, e.g.
// DATABASE_URL=postgres://postgres@localhost:5432/reposafety REDIS_URL=redis://localhost:6379 pnpm test
const DB = process.env.DATABASE_URL;
const REDIS = process.env.REDIS_URL;

const record = (over: Partial<ScanRecord> = {}): ScanRecord => ({
  id: randomUUID(), status: "queued", target: "github.com/acme/x", engineVersion: VERSION, createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe.skipIf(!DB)("PgStore (Postgres)", () => {
  const store = new PgStore(DB!);
  afterAll(() => store.close());

  it("creates, updates, caches and expires scans", async () => {
    await store.migrate();
    const key = `github:acme/x@${randomUUID()}`;
    const rec = record({ cacheKey: key });
    await store.create(rec);
    expect(await store.findCached(key, VERSION)).toBeUndefined();
    await store.update(rec.id, { status: "done", report: { verdict: "safe" } as never });
    expect((await store.findCached(key, VERSION))?.id).toBe(rec.id);
    expect((await store.get(rec.id))?.report).toEqual({ verdict: "safe" });
    expect((await store.latestForTarget("github.com/acme/x", 60_000))?.status).toBeDefined();
    const old = record({ createdAt: new Date(Date.now() - 40 * 86_400_000) });
    await store.create(old);
    expect(await store.deleteOlderThan(new Date(Date.now() - 30 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect(await store.get(old.id)).toBeUndefined();
  });
});

describe.skipIf(!DB || !REDIS)("BullMQ queue + worker", () => {
  it("runs a queued upload scan in a worker and stores the report", async () => {
    const store = new PgStore(DB!);
    await store.migrate();
    const blobs = new MemoryBlobs();
    const rec = record({ target: "take-home.zip" });
    await store.create(rec);
    await blobs.put(`uploads/${rec.id}.zip`, buildZip([{ name: "package.json", data: JSON.stringify({ scripts: { postinstall: "echo hello" } }) }]));

    const done = new Promise<void>((resolve) => {
      const worker = new Worker(QUEUE_NAME, async (job) => {
        await processScan(job.data, { store, blobs, maxDownloadBytes: 1e6 });
        resolve();
      }, { connection: redisConnection(REDIS!) });
      afterAll(() => worker.close());
    });
    const queue = new BullQueue(REDIS!);
    await queue.enqueue({ id: rec.id, kind: "upload", uploadKey: `uploads/${rec.id}.zip`, fileName: "take-home.zip" });
    await done;
    const saved = await store.get(rec.id);
    expect(saved?.status).toBe("done");
    expect(saved?.report?.verdict).toBe("suspicious");
    expect(blobs.size).toBe(0);
    await queue.close();
    await store.close();
  }, 20_000);
});
