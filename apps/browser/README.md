# Repo-Safety browser extension

Shows a risk badge next to the repo name on GitHub repo pages: **Dangerous**, **Suspicious** or **No traps found**. Click it for the full report. The toolbar icon shows the same verdict (`!`, `?` or `✓`).

It sends only the repo's owner and name to your Repo-Safety server (`apps/web`), which scans the public repo and caches the result per commit. Nothing is downloaded to your machine.

## Try it

```bash
pnpm install && pnpm build                                     # builds core, server and this extension
REPO_SAFETY_INLINE_WORKER=1 node apps/web/server/dist/api.js     # server on http://localhost:8080
```

- **Chrome / Edge:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, choose `apps/browser/dist`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on**, choose `apps/browser/dist/manifest.json`.

Point it at a deployed server from the extension's options page (https only, except localhost).

## Files

| File | Role |
|---|---|
| `src/content.ts` | Finds the repo from the URL (GitHub navigates without page loads), draws the badge using text only |
| `src/background.ts` | Calls the server's `/api/repos/github/:owner/:repo`, polls until the scan is done, caches for an hour, sets the toolbar badge |
| `src/options.ts` | Server URL setting, asks for host permission for custom servers |
| `src/shared.ts` | URL parsing and badge text (unit tested) |
| `static/` | Manifest (MV3), CSS, options page |
