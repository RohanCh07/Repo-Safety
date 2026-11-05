# @repo-safety/core

The shared scanning engine. It reads a folder or ZIP **without executing anything**, runs a set of rules, and returns a report with a verdict, risk score and findings (file, line, snippet, plain-English explanation).

## CLI

```bash
pnpm --filter @repo-safety/core build
node packages/core/dist/cli.js scan ./some-take-home-test        # folder
node packages/core/dist/cli.js scan ./take-home.zip --json        # ZIP, JSON output
```

Exit codes: `0` safe, `1` suspicious, `2` dangerous, `3` error or rejected input.

## Library

```ts
import { scanFolder, scanZipBuffer, formatText } from "@repo-safety/core";

const report = await scanFolder("./take-home");
console.log(report.verdict, report.score);
console.log(formatText(report));
```

## Rules

| Rule id | What it catches | Severity |
|---|---|---|
| `vscode-autorun-task` | `.vscode/tasks.json` / `.code-workspace` tasks with `runOn: folderOpen`; other tasks with risky commands | dangerous / suspicious |
| `vscode-settings-exec` | Settings pointing an interpreter, linter or shell at a file shipped in the repo; `task.allowAutomaticTasks`; terminal env injection (`NODE_OPTIONS`, `LD_PRELOAD`, ...) | dangerous / suspicious |
| `devcontainer-command` | `initializeCommand` (runs on your machine); risky lifecycle commands; privileged containers; home/credential mounts | dangerous / suspicious |
| `npm-lifecycle-script` | `preinstall` / `install` / `postinstall` / `prepare` scripts, including risky code in the file they run | dangerous / suspicious |
| `git-hooks` | Real hooks in `.git/hooks` (dangerous in a ZIP, suspicious in a local folder, git-lfs hooks ignored), exec-capable `.git/config` keys (`fsmonitor`, `hooksPath`, `sshCommand`, `!` aliases), risky husky hooks | dangerous / suspicious |
| `jetbrains-startup-task` | `.idea` startup tasks that run when a JetBrains IDE opens the project | dangerous |
| `python-install-hook` | `setup.py` running commands or custom install classes, in-tree `backend-path`, executable `.pth` files | dangerous / suspicious |
| `build-script-exec` | Download-and-run lines in shell scripts, Makefiles, Dockerfiles, PowerShell; Terraform `data "external"` (runs on plan) and `local-exec` | dangerous / suspicious |
| `obfuscated-code` | Code hidden off-screen after long runs of spaces, eval/exec on decoded or downloaded data, encoded blobs next to a decoder, packed lines with obfuscator fingerprints | dangerous / suspicious |
| `suspicious-dependency` | Dependencies from Git/HTTP URLs instead of npm/PyPI, unofficial package indexes, names one typo away from popular packages | suspicious |
| `symlink-escape` | Symlinks pointing outside the project | suspicious |

Adding a rule: create `src/rules/<name>.ts` exporting a `Rule`, add it to `src/rules/index.ts`, and add a harmless fixture plus a test.

## Ingestion safety

- Paths are normalized; absolute paths, `..` segments and NUL bytes are rejected (zip-slip).
- ZIPs are read in memory, never extracted. Entry count, total size, per-file size and compression ratio are capped, and decompression stops as soon as an entry produces more bytes than allowed, whatever its header claims (zip bombs).
- Symlinks are recorded but never followed. Encrypted entries are rejected.
- Folder scans skip `node_modules` and `.git/objects`, but still read `.git/hooks` and `.git/config`.

Limits live in `src/ingest/limits.ts` and can be overridden per scan.
