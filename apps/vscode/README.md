# Repo-Safety for VS Code

Checks a folder for auto-run traps (folder-open tasks, settings that start programs, install scripts, git hooks, hidden code) **without running any of its code**, and shows what it found in the Problems panel.

## How it protects you

- The extension declares support for **Restricted Mode**, so it runs even when you haven't trusted the folder yet. Restricted Mode is what stops tasks from auto-running, so this is the moment to check.
- On startup it scans every untrusted workspace folder. If it finds a trap it shows a warning that tells you **not** to trust the folder, puts every finding in the Problems panel with its exact line, and sets a red status bar badge.
- **Safest option:** run `Repo-Safety: Scan a Folder Without Opening It…` or `Repo-Safety: Scan a ZIP File…` from the Command Palette. The code is never opened as a workspace, so nothing in it can run.

> VS Code may show its own "Do you trust the authors?" dialog as soon as a folder opens, before any extension can finish. Choose **No, I don't trust the authors** (Restricted Mode), let Repo-Safety finish, then decide. To skip that dialog entirely, set `"security.workspace.trust.startupPrompt": "never"` so new folders always open in Restricted Mode.

## Commands

| Command | What it does |
|---|---|
| Repo-Safety: Scan This Workspace | Rescan the open folders |
| Repo-Safety: Scan a Folder Without Opening It… | Pick any folder and scan it without opening it |
| Repo-Safety: Scan a ZIP File… | Scan a downloaded ZIP without extracting it |
| Repo-Safety: Show Last Report | Show the full plain-English report |

Setting `repoSafety.scanOnOpen`: `untrusted` (default), `always` or `never`.

## Develop

```bash
pnpm install
pnpm --filter @repo-safety/core build
pnpm --filter repo-safety-vscode build   # bundles to dist/extension.js
pnpm --filter repo-safety-vscode test
```

Press F5 in VS Code with this folder open to launch an Extension Development Host. Package with `pnpm --filter repo-safety-vscode package` (needs `@vscode/vsce`).
