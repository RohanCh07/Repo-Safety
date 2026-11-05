import { randomUUID } from "node:crypto";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { VERSION } from "@repo-safety/core";
import type { BlobStore } from "./blobs.js";
import type { JobQueue } from "./queue.js";
import { parseRepoUrl, repoLabel, resolveCommit, SourceError, type FetchLike } from "./source.js";
import type { ScanStore } from "./store.js";
import type { Host, RepoRef, ScanRecord } from "./types.js";

export interface AppDeps {
  store: ScanStore;
  blobs: BlobStore;
  queue: JobQueue;
  maxUploadBytes: number;
  rateLimitPerMinute: number;
  githubToken?: string;
  fetch?: FetchLike;
  /** Folder with the static frontend. Omit to serve the API only. */
  publicDir?: string;
  logger?: boolean;
}

const BADGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What the API returns for a scan. Never includes internal fields. */
function publicView(r: ScanRecord) {
  return {
    id: r.id,
    status: r.status,
    target: r.target,
    createdAt: r.createdAt,
    ...(r.report ? { report: r.report } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 16 * 1024, trustProxy: true });

  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: deps.maxUploadBytes, files: 1, fields: 0, parts: 2 } });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("content-security-policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (err instanceof SourceError) return reply.status(err.status).send({ error: err.message });
    if (err.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(413).send({ error: `File is larger than ${Math.round(deps.maxUploadBytes / 1048576)} MB.` });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: "Something went wrong on our side." });
  });

  const limited = { config: { rateLimit: { max: deps.rateLimitPerMinute, timeWindow: "1 minute" } } };

  /** Create (or reuse) a scan for a repo. */
  async function startRepoScan(repo: RepoRef): Promise<{ record: ScanRecord; cached: boolean }> {
    const commit = await resolveCommit(repo, { fetch: deps.fetch, githubToken: deps.githubToken });
    const cacheKey = commit ? `${repo.host}:${repo.owner}/${repo.repo}@${commit}`.toLowerCase() : undefined;
    if (cacheKey) {
      const hit = await deps.store.findCached(cacheKey, VERSION);
      if (hit) return { record: hit, cached: true };
    }
    const now = new Date();
    const record: ScanRecord = {
      id: randomUUID(),
      status: "queued",
      target: repoLabel(repo),
      engineVersion: VERSION,
      createdAt: now,
      updatedAt: now,
      ...(cacheKey ? { cacheKey } : {}),
    };
    await deps.store.create(record);
    await deps.queue.enqueue({ id: record.id, kind: "repo", repo, ...(commit ? { commit } : {}) });
    return { record, cached: false };
  }

  app.get("/api/health", async () => ({ ok: true, engine: VERSION }));

  app.post<{ Body: { url?: unknown } }>("/api/scans", limited, async (req, reply) => {
    const url = typeof req.body?.url === "string" ? req.body.url : "";
    if (!url) throw new SourceError("Send a JSON body like {\"url\": \"https://github.com/owner/repo\"}.");
    const { record, cached } = await startRepoScan(parseRepoUrl(url));
    return reply.status(cached ? 200 : 202).send({ ...publicView(record), cached });
  });

  app.post("/api/scans/upload", limited, async (req, reply) => {
    const file = await req.file();
    if (!file) throw new SourceError("Attach a .zip file in a field named \"file\".");
    const name = path.basename(file.filename || "upload.zip").replace(/[^\w.@ -]/g, "_").slice(0, 120);
    if (!/\.zip$/i.test(name)) throw new SourceError("Only .zip files are supported.");
    const data = await file.toBuffer();
    if (file.file.truncated) throw new SourceError(`File is larger than ${Math.round(deps.maxUploadBytes / 1048576)} MB.`, 413);

    const now = new Date();
    const record: ScanRecord = { id: randomUUID(), status: "queued", target: name, engineVersion: VERSION, createdAt: now, updatedAt: now };
    const uploadKey = `uploads/${record.id}.zip`;
    await deps.blobs.put(uploadKey, data);
    await deps.store.create(record);
    await deps.queue.enqueue({ id: record.id, kind: "upload", uploadKey, fileName: name });
    return reply.status(202).send(publicView(record));
  });

  app.get<{ Params: { id: string } }>("/api/scans/:id", async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.status(404).send({ error: "Scan not found." });
    const rec = await deps.store.get(req.params.id);
    if (!rec) return reply.status(404).send({ error: "Scan not found or expired." });
    return publicView(rec);
  });

  /**
   * Compact status for the browser extension badge. Returns the latest scan
   * of this repo from the last 24 hours, or starts one.
   */
  app.get<{ Params: { host: string; owner: string; repo: string }; Querystring: { ref?: string } }>(
    "/api/repos/:host/:owner/:repo",
    limited,
    async (req) => {
      const host = req.params.host as Host;
      if (!["github", "gitlab", "bitbucket"].includes(host)) throw new SourceError("Unsupported host.");
      const domain = host === "bitbucket" ? "bitbucket.org" : `${host}.com`;
      const ref = typeof req.query.ref === "string" && req.query.ref ? `/tree/${req.query.ref}` : "";
      const repo = parseRepoUrl(`https://${domain}/${req.params.owner}/${req.params.repo}${ref}`);
      let rec = await deps.store.latestForTarget(repoLabel(repo), BADGE_MAX_AGE_MS);
      if (!rec) rec = (await startRepoScan(repo)).record;
      return {
        id: rec.id,
        status: rec.status,
        target: rec.target,
        reportPath: `/r/${rec.id}`,
        ...(rec.report ? { verdict: rec.report.verdict, score: rec.report.score, counts: rec.report.counts, summary: rec.report.summary } : {}),
        ...(rec.error ? { error: rec.error } : {}),
      };
    },
  );

  if (deps.publicDir) {
    await app.register(fastifyStatic, { root: deps.publicDir, index: ["index.html"] });
    app.get("/r/:id", (_req, reply) => reply.sendFile("report.html"));
  }

  return app;
}
