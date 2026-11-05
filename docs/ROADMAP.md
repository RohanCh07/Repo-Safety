# Roadmap

Each phase ends with something that works and can be shown. Later phases build on the shared engine in `packages/core`.

## Phase 0: Project setup
- [x] Monorepo layout (pnpm workspaces), README, roadmap
- [x] TypeScript and Vitest config (`pnpm lint` type-checks)
- [ ] ESLint/Prettier
- [x] GitHub Actions: install, lint, test on every push

## Phase 1: Scanning engine (`packages/core`)
Goal: a library and a small CLI (`repo-safety scan <path-or-zip>`) that prints a report.

**Safe ingestion**
- [x] Read a folder or ZIP into an in-memory file list without executing anything
- [x] Limits: total size, file count, per-file size, path depth
- [x] Reject zip-slip (`../`, absolute paths) and zip bombs (compression ratio checks)
- [x] Skip binary and oversized files, but still record that they exist

**Rule engine**
- [x] `Rule` interface: `id`, `title`, `severity`, `check(files) => Finding[]`
- [x] `Finding`: rule id, severity, file, line, snippet, plain-English explanation

**First rules (match real attacks)**
- [x] `.vscode/tasks.json` with `runOn: folderOpen`
- [x] `.vscode/settings.json` that points to programs to run
- [x] `.devcontainer/devcontainer.json` lifecycle commands
- [x] `package.json` lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`)
- [x] `.git/hooks/*` present in an upload, plus exec-capable `.git/config` keys
- [x] Symlinks that point outside the project

**Scoring and report**
- [x] Severity weights and verdict: any Dangerous → Dangerous; Suspicious findings → Suspicious; else Safe
- [x] JSON report + readable terminal output

**Tests**
- [x] Harmless "malicious-like" fixtures for each rule, each must be caught with the right file and line
- [x] Benign fixtures that must produce no findings

## Phase 2: More rules and accuracy
- [x] Python: `setup.py` running commands, `pyproject.toml` in-tree build backends, executable `.pth` files
- [x] `Makefile`, shell scripts, Dockerfiles, PowerShell: download-and-run patterns
- [x] Terraform: `data "external"` (runs on plan) and `local-exec`
- [x] JetBrains `.idea/` startup tasks
- [x] Obfuscation: code hidden off-screen, encoded blobs next to a decoder, packed lines with obfuscator fingerprints
- [x] `eval` / `new Function` / `exec` on decoded or downloaded data (line-based; string literals ignored)
- [ ] Same check with real ASTs (Tree-sitter) to follow data across lines
- [x] Suspicious dependencies: typosquats of popular npm/PyPI names, Git/URL dependencies, unofficial package indexes
- [ ] Non-existent or brand-new packages (needs registry lookups, see Phase 6)
- [x] False-positive pass on 21 popular repos (results below)
- [x] Performance: typical repo scans in under 30 seconds

**False-positive pass (shallow clones, Nov 2026):** express, lodash, axios, flask, requests, django, fastapi, numpy, pandas, eslint, prettier, vite, nest, vue core, tailwindcss, terraform-aws-vpc and the TypeScript repo (68k files, 12s) all come out **Safe**. react, svelte, webpack and vscode come out **Suspicious**, never Dangerous, for real install scripts, a nested folder-open task, a privileged dev container and WebAssembly blobs that are decoded at runtime. Most scans take 0.1 to 2 seconds.

## Phase 3: VS Code extension (`apps/vscode`)
- [x] Declare support for untrusted workspaces so it runs in Restricted Mode
- [x] Scan untrusted folders automatically and warn before the user trusts them
- [x] Show findings in the Problems panel with clickable file/line
- [x] Commands: scan workspace, scan a folder without opening it, scan a ZIP, show report; status bar verdict
- [ ] Integration tests with `@vscode/test-electron`
- [ ] Icon, marketplace listing, publish to the VS Code Marketplace and Open VSX

## Phase 4: Web app (`apps/web`)
- [ ] Fastify API: `POST /scans` (repo URL or ZIP upload), `GET /scans/:id`
- [ ] Fetch GitHub/GitLab/Bitbucket repos as archives, never `git clone` with hooks
- [ ] BullMQ + Redis job queue, scans run in isolated worker processes
- [ ] Postgres for reports, cached by commit hash
- [ ] S3-compatible storage for uploads with automatic deletion
- [ ] Rate limiting and upload abuse protection
- [ ] Next.js frontend: paste-a-link page and shareable report page
- [ ] Docker Compose for local development

## Phase 5: Browser extension (`apps/browser`)
- [ ] Manifest V3, works in Chrome, Edge and Firefox
- [ ] Content script adds a risk badge to GitHub repo pages
- [ ] Background worker calls the web API and caches results
- [ ] Link from the badge to the full report

## Phase 6: Later
- [ ] LLM explanations of findings and second-opinion review of suspicious files
- [ ] Dependency reputation checks against npm/PyPI
- [ ] Image and binary payload heuristics
- [ ] Disposable sandbox on a separate host (gVisor or Firecracker), no network egress, behavior report
- [ ] Public API for CI and recruiting tools; team plans

## Done looks like
- Catches every harmless test sample that imitates a known trap, with exact file and line
- Low false positives on 50 popular legitimate repos
- A typical scan finishes in under 30 seconds
- Zip bombs and path traversal uploads are rejected safely
- Every finding is explained in language a junior developer understands
