import { Worker } from "bullmq";
import { loadConfig } from "./config.js";
import { makeStorage } from "./deps.js";
import { processScan } from "./processor.js";
import { QUEUE_NAME, redisConnection } from "./queue.js";
import type { ScanJob } from "./types.js";

const cfg = loadConfig();
if (!cfg.redisUrl) throw new Error("REDIS_URL is required for the worker.");
const { store, blobs } = await makeStorage({ ...cfg, inlineWorker: false });

// Each worker process handles a few scans at a time. Scale by running more processes.
const worker = new Worker<ScanJob>(
  QUEUE_NAME,
  (job) => processScan(job.data, { store, blobs, maxDownloadBytes: cfg.maxDownloadBytes, githubToken: cfg.githubToken, log: (m, e) => console.log(JSON.stringify({ msg: m, ...e })) }),
  { connection: redisConnection(cfg.redisUrl), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4), lockDuration: 120_000 },
);

worker.on("failed", (job, err) => console.error(JSON.stringify({ msg: "job failed", id: job?.id, error: err.message })));
console.log(JSON.stringify({ msg: "worker ready", queue: QUEUE_NAME }));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await worker.close();
    await store.close?.();
    process.exit(0);
  });
}
