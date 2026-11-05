# Repo-Safety

**Is this repo safe to open?** Repo-Safety checks an untrusted repository or ZIP, such as a "take-home coding test" from a recruiter, for hidden auto-run traps *before* it touches your machine.

It looks for things like VS Code tasks that run when a folder opens, git hooks hidden in ZIPs, npm install scripts, obfuscated code and suspicious dependencies. It returns a verdict (**Safe / Suspicious / Dangerous**) with the exact file, line and a plain-English reason.

> A scan reduces risk. It cannot guarantee a repo is safe.

## How it's delivered

| Surface | What it does | Folder |
|---|---|---|
| Scanning engine | The shared rule engine. Never executes anything from a scanned repo. | `packages/core` |
| VS Code extension | Scans a folder locally while VS Code is in Restricted Mode, before you click "Trust". | `apps/vscode` |
| Web app | Paste a link or upload a ZIP and get a shareable report. | `apps/web` |
| Browser extension | Shows a risk badge on GitHub repo pages. | `apps/browser` |

## Quick start

```bash
pnpm install && pnpm build
node packages/core/dist/cli.js scan ./some-take-home-test   # CLI
REPO_SAFETY_INLINE_WORKER=1 node apps/web/server/dist/api.js  # web app on :8080
```

## Repository layout

```
Repo-Safety/
├── docs/                  Roadmap and design notes
├── packages/
│   └── core/              Shared scanning engine (TypeScript)
│       ├── src/
│       │   ├── ingest/    Safe ZIP/folder reading: size limits, zip-slip and zip-bomb protection
│       │   ├── rules/     One file per rule (tasks.json, package.json scripts, git hooks, ...)
│       │   ├── scoring/   Severity weights and the overall verdict
│       │   └── report/    The JSON report format shared by every surface
│       └── test/
│           └── fixtures/
│               ├── malicious-like/  Harmless samples that only imitate traps
│               └── benign/          Normal repos that must not be flagged
├── apps/
│   ├── vscode/            VS Code extension
│   ├── web/
│   │   ├── server/        Fastify API and BullMQ scan workers
│   │   └── frontend/      Static HTML/CSS/JS pages
│   └── browser/           Browser extension (Manifest V3)
└── .github/workflows/     CI
```

## Tech stack

TypeScript on Node 20+ everywhere, pnpm workspaces, Vitest. Web app: Fastify, BullMQ + Redis, Postgres, S3-compatible storage (MinIO locally), plain HTML/CSS/JS pages, Docker Compose. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full plan.

## Scanning this repo itself

Running the scanner on this repository reports **Dangerous**. That is expected: `packages/core/test/fixtures/malicious-like/` holds harmless imitations of every trap so the tests can prove each rule works.

## Safety rules for contributors

- **Never put real malware in this repo.** Test fixtures only *imitate* trap patterns with harmless commands (for example `echo hello`).
- The scanner must **never execute** anything from a scanned repo. Analysis is read-only.
- Treat every input as hostile: limit sizes, block path traversal, scan in isolated workers.
