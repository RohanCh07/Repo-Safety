import { MemoryBlobs, S3Blobs, type BlobStore } from "./blobs.js";
import type { Config } from "./config.js";
import { MemoryStore, PgStore, type ScanStore } from "./store.js";

/** Build storage from config: Postgres + S3 in production, memory for local dev. */
export async function makeStorage(cfg: Config): Promise<{ store: ScanStore; blobs: BlobStore }> {
  let store: ScanStore;
  if (cfg.databaseUrl) {
    const pg = new PgStore(cfg.databaseUrl);
    await pg.migrate();
    store = pg;
  } else {
    store = new MemoryStore();
  }
  const blobs: BlobStore = cfg.s3 ? new S3Blobs(cfg.s3) : new MemoryBlobs();
  if (!cfg.inlineWorker && (!cfg.databaseUrl || !cfg.s3)) {
    throw new Error("Separate workers need shared storage: set DATABASE_URL and S3_BUCKET, or REPO_SAFETY_INLINE_WORKER=1.");
  }
  return { store, blobs };
}
