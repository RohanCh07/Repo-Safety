# Web app

Paste a repo link or upload a ZIP, get a shareable report.

```
browser ──► API (Fastify) ──► Postgres (reports, cached per commit)
               │   └──────► S3 / MinIO (uploaded ZIPs, deleted after scanning)
               └─► Redis queue (BullMQ) ──► scan workers ──► @repo-safety/core
```

| Folder | What it is |
|---|---|
| `server/src/api.ts` | HTTP API and static pages |
| `server/src/worker.ts` | Scan worker process (run as many as you like) |
| `server/src/processor.ts` | One scan job: download or load the ZIP, scan it in memory, save the report |
| `server/src/source.ts` | Repo link parsing and safe archive downloads |
| `frontend/public` | Plain HTML/CSS/JS pages (no build step) |

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/scans` | Body `{"url": "https://github.com/owner/repo"}`. Returns `202` with a scan id, or `200` with a cached report for the same commit. |
| `POST` | `/api/scans/upload` | Multipart field `file` with a `.zip` (50 MB max). |
| `GET` | `/api/scans/:id` | Scan status and report. |
| `GET` | `/api/repos/:host/:owner/:repo` | Compact verdict for the browser extension badge; starts a scan if there's none from the last 24 hours. |
| `GET` | `/r/:id` | Shareable report page. |

## Safety

- Only `https` links to github.com, gitlab.com and bitbucket.org are accepted, and every download redirect is checked against an allowlist (no SSRF).
- Downloads and uploads are size-capped; archives are scanned in memory and never extracted or executed.
- Uploaded ZIPs are deleted right after scanning; reports are deleted after `REPORT_RETENTION_DAYS` (30).
- Scan endpoints are rate limited per IP (`RATE_LIMIT_PER_MINUTE`, default 20).
- Pages use a strict Content Security Policy, and report data is only ever inserted as text.

## Run it

**Quick (no Docker, scans run inside the API process, data kept in memory):**

```bash
pnpm install && pnpm build
REPO_SAFETY_INLINE_WORKER=1 node apps/web/server/dist/api.js   # http://localhost:8080
```

**Full stack (Postgres, Redis, MinIO, 2 workers):** `docker compose up --build` from the repo root.

**Tests:** `pnpm --filter @repo-safety/web-server test`. To also run the Postgres and Redis integration tests, set `DATABASE_URL` and `REDIS_URL`.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATABASE_URL` | (memory) | Postgres connection string |
| `REDIS_URL` | (inline worker) | Redis for the BullMQ queue |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | (memory) | Upload storage |
| `GITHUB_TOKEN` | none | Higher GitHub API rate limits |
| `MAX_UPLOAD_MB` / `MAX_DOWNLOAD_MB` | `50` / `100` | Size caps |
| `REPORT_RETENTION_DAYS` | `30` | Report retention |
| `REPO_SAFETY_INLINE_WORKER` | off | Run scans inside the API process |
