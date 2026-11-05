import { Queue } from "bullmq";
import type { ScanJob } from "./types.js";

export const QUEUE_NAME = "repo-safety-scans";

export interface JobQueue {
  enqueue(job: ScanJob): Promise<void>;
  close?(): Promise<void>;
}

/** Runs jobs in the same process, one at a time. For local dev and tests. */
export class InlineQueue implements JobQueue {
  private chain: Promise<void> = Promise.resolve();
  constructor(private run: (job: ScanJob) => Promise<void>) {}
  async enqueue(job: ScanJob) {
    this.chain = this.chain.then(() => this.run(job)).catch(() => undefined);
  }
  /** Resolves once every queued job has finished. */
  idle() {
    return this.chain;
  }
}

export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

/** BullMQ queue backed by Redis. Workers run in separate processes (see worker.ts). */
export class BullQueue implements JobQueue {
  private queue: Queue;
  constructor(redisUrl: string) {
    this.queue = new Queue(QUEUE_NAME, { connection: redisConnection(redisUrl) });
  }
  async enqueue(job: ScanJob) {
    await this.queue.add("scan", job, {
      jobId: job.id,
      attempts: 2,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }
  async close() {
    await this.queue.close();
  }
}
