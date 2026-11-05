import pg from "pg";
import type { ScanRecord } from "./types.js";

export interface ScanStore {
  create(rec: ScanRecord): Promise<void>;
  get(id: string): Promise<ScanRecord | undefined>;
  update(id: string, patch: Partial<Omit<ScanRecord, "id" | "createdAt">>): Promise<void>;
  /** A finished report for the same commit and engine version, if one exists. */
  findCached(cacheKey: string, engineVersion: string): Promise<ScanRecord | undefined>;
  /** Latest scan for a repo label (any status), used by the browser badge. */
  latestForTarget(target: string, maxAgeMs: number): Promise<ScanRecord | undefined>;
  deleteOlderThan(cutoff: Date): Promise<number>;
  close?(): Promise<void>;
}

export class MemoryStore implements ScanStore {
  private rows = new Map<string, ScanRecord>();
  async create(rec: ScanRecord) {
    this.rows.set(rec.id, structuredClone(rec));
  }
  async get(id: string) {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : undefined;
  }
  async update(id: string, patch: Partial<ScanRecord>) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...structuredClone(patch), updatedAt: new Date() });
  }
  async findCached(cacheKey: string, engineVersion: string) {
    return [...this.rows.values()]
      .filter((r) => r.cacheKey === cacheKey && r.engineVersion === engineVersion && r.status === "done")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }
  async latestForTarget(target: string, maxAgeMs: number) {
    const since = Date.now() - maxAgeMs;
    return [...this.rows.values()]
      .filter((r) => r.target === target && r.createdAt.getTime() >= since && r.status !== "failed")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }
  async deleteOlderThan(cutoff: Date) {
    let n = 0;
    for (const [id, r] of this.rows) if (r.createdAt < cutoff && this.rows.delete(id)) n++;
    return n;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scans (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL,
  target         TEXT NOT NULL,
  cache_key      TEXT,
  engine_version TEXT NOT NULL,
  report         JSONB,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scans_cache_idx ON scans (cache_key, engine_version) WHERE status = 'done';
CREATE INDEX IF NOT EXISTS scans_target_idx ON scans (target, created_at DESC);
CREATE INDEX IF NOT EXISTS scans_created_idx ON scans (created_at);
`;

type Row = {
  id: string; status: ScanRecord["status"]; target: string; cache_key: string | null; engine_version: string;
  report: ScanRecord["report"] | null; error: string | null; created_at: Date; updated_at: Date;
};

const fromRow = (r: Row): ScanRecord => ({
  id: r.id,
  status: r.status,
  target: r.target,
  engineVersion: r.engine_version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(r.cache_key ? { cacheKey: r.cache_key } : {}),
  ...(r.report ? { report: r.report } : {}),
  ...(r.error ? { error: r.error } : {}),
});

export class PgStore implements ScanStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }
  async migrate() {
    await this.pool.query(SCHEMA);
  }
  async create(rec: ScanRecord) {
    await this.pool.query(
      `INSERT INTO scans (id, status, target, cache_key, engine_version, report, error, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [rec.id, rec.status, rec.target, rec.cacheKey ?? null, rec.engineVersion, rec.report ? JSON.stringify(rec.report) : null, rec.error ?? null, rec.createdAt, rec.updatedAt],
    );
  }
  async get(id: string) {
    const { rows } = await this.pool.query<Row>("SELECT * FROM scans WHERE id = $1", [id]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }
  async update(id: string, patch: Partial<ScanRecord>) {
    const cols: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      cols.push(`${col} = $${vals.length}`);
    };
    if (patch.status) set("status", patch.status);
    if (patch.report !== undefined) set("report", JSON.stringify(patch.report));
    if (patch.error !== undefined) set("error", patch.error);
    if (patch.cacheKey !== undefined) set("cache_key", patch.cacheKey);
    if (patch.target !== undefined) set("target", patch.target);
    vals.push(id);
    await this.pool.query(`UPDATE scans SET ${[...cols, "updated_at = now()"].join(", ")} WHERE id = $${vals.length}`, vals);
  }
  async findCached(cacheKey: string, engineVersion: string) {
    const { rows } = await this.pool.query<Row>(
      "SELECT * FROM scans WHERE cache_key = $1 AND engine_version = $2 AND status = 'done' ORDER BY created_at DESC LIMIT 1",
      [cacheKey, engineVersion],
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  }
  async latestForTarget(target: string, maxAgeMs: number) {
    const { rows } = await this.pool.query<Row>(
      "SELECT * FROM scans WHERE target = $1 AND status <> 'failed' AND created_at >= $2 ORDER BY created_at DESC LIMIT 1",
      [target, new Date(Date.now() - maxAgeMs)],
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  }
  async deleteOlderThan(cutoff: Date) {
    const res = await this.pool.query("DELETE FROM scans WHERE created_at < $1", [cutoff]);
    return res.rowCount ?? 0;
  }
  async close() {
    await this.pool.end();
  }
}
