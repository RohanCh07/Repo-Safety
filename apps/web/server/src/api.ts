import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { makeStorage } from "./deps.js";
import { processScan } from "./processor.js";
import { BullQueue, InlineQueue, type JobQueue } from "./queue.js";

const cfg = loadConfig();
const { store, blobs } = await makeStorage(cfg);

const queue: JobQueue = cfg.inlineWorker
  ? new InlineQueue((job) => processScan(job, { store, blobs, maxDownloadBytes: cfg.maxDownloadBytes, githubToken: cfg.githubToken, log: console.log }))
  : new BullQueue(cfg.redisUrl!);

const publicDir = process.env.PUBLIC_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/public");
const app = await buildApp({ store, blobs, queue, publicDir, maxUploadBytes: cfg.maxUploadBytes, rateLimitPerMinute: cfg.rateLimitPerMinute, githubToken: cfg.githubToken, logger: true });

// Retention: delete reports older than the configured number of days, hourly.
const sweep = () =>
  store
    .deleteOlderThan(new Date(Date.now() - cfg.reportRetentionDays * 86_400_000))
    .then((n) => n && app.log.info({ deleted: n }, "expired reports deleted"))
    .catch((err) => app.log.error(err));
setInterval(sweep, 3_600_000).unref();
void sweep();

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info(cfg.inlineWorker ? "Scans run inside the API process (inline worker)." : "Scans are queued in Redis for separate workers.");
