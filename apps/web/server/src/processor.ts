import { IngestError, scanZipBuffer, VERSION } from "@repo-safety/core";
import type { BlobStore } from "./blobs.js";
import { archiveUrl, downloadArchive, repoLabel, SourceError, type FetchLike } from "./source.js";
import type { ScanStore } from "./store.js";
import type { ScanJob } from "./types.js";

export interface ProcessorDeps {
  store: ScanStore;
  blobs: BlobStore;
  maxDownloadBytes: number;
  githubToken?: string;
  fetch?: FetchLike;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Run one scan job. The archive is only ever read in memory by the core
 * engine; nothing from it is written to disk or executed.
 */
export async function processScan(job: ScanJob, deps: ProcessorDeps): Promise<void> {
  const { store, blobs } = deps;
  await store.update(job.id, { status: "running" });
  try {
    let zip: Buffer;
    let label: string;
    if (job.kind === "repo") {
      label = repoLabel(job.repo);
      zip = await downloadArchive(archiveUrl(job.repo, job.commit), deps.maxDownloadBytes, { fetch: deps.fetch, githubToken: deps.githubToken });
    } else {
      label = job.fileName;
      const data = await blobs.get(job.uploadKey);
      if (!data) throw new SourceError("The uploaded file has expired. Please upload it again.", 410);
      zip = data;
    }
    const report = await scanZipBuffer(zip, { label });
    await store.update(job.id, { status: "done", report });
    deps.log?.("scan finished", { id: job.id, verdict: report.verdict, ms: report.stats.durationMs, engine: VERSION });
  } catch (err) {
    const message =
      err instanceof IngestError ? `This archive was rejected: ${err.message}` : err instanceof SourceError ? err.message : "The scan failed unexpectedly. Please try again.";
    await store.update(job.id, { status: "failed", error: message });
    deps.log?.("scan failed", { id: job.id, error: (err as Error).message });
  } finally {
    // Retention policy: uploads are deleted as soon as they have been scanned.
    if (job.kind === "upload") await blobs.delete(job.uploadKey).catch(() => undefined);
  }
}
