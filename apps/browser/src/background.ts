import { actionBadge, DEFAULT_API, type BadgeState, type Message, type RepoPage } from "./shared.js";

const CACHE_MS = 60 * 60 * 1000;

async function apiBase(): Promise<string> {
  const { api } = await chrome.storage.sync.get("api");
  return (typeof api === "string" && api ? api : DEFAULT_API).replace(/\/+$/, "");
}

interface RepoSummary {
  status: "queued" | "running" | "done" | "failed";
  reportPath: string;
  verdict?: "safe" | "suspicious" | "dangerous";
  score?: number;
  summary?: string;
  error?: string;
}

/** Ask the server about a repo, polling until the scan finishes (up to ~90 s). */
async function check(page: RepoPage): Promise<BadgeState> {
  const key = `repo:${page.owner}/${page.repo}@${page.ref ?? ""}`.toLowerCase();
  const cached = (await chrome.storage.session.get(key))[key] as { at: number; state: BadgeState } | undefined;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.state;

  const base = await apiBase();
  const url = `${base}/api/repos/github/${encodeURIComponent(page.owner)}/${encodeURIComponent(page.repo)}${page.ref ? `?ref=${encodeURIComponent(page.ref)}` : ""}`;
  let delay = 1000;
  for (let i = 0; i < 25; i++) {
    let body: RepoSummary & { error?: string };
    try {
      const res = await fetch(url);
      body = await res.json();
      if (!res.ok) return { verdict: "error", error: body.error ?? `Server error (${res.status}).` };
    } catch {
      return { verdict: "error", error: "Couldn't reach the Repo-Safety server. Check the extension options." };
    }
    if (body.status === "done" && body.verdict) {
      const state: BadgeState = { verdict: body.verdict, score: body.score, summary: body.summary, reportUrl: `${base}${body.reportPath}` };
      await chrome.storage.session.set({ [key]: { at: Date.now(), state } });
      return state;
    }
    if (body.status === "failed") return { verdict: "error", error: body.error, reportUrl: `${base}${body.reportPath}` };
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
  return { verdict: "error", error: "The scan is taking too long. Try again in a minute." };
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg?.type !== "check") return false;
  const tabId = sender.tab?.id;
  const setAction = (s: BadgeState) => {
    if (tabId === undefined) return;
    const b = actionBadge(s.verdict);
    void chrome.action.setBadgeText({ tabId, text: b.text });
    void chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
  };
  setAction({ verdict: "scanning" });
  check(msg.page).then((state) => {
    setAction(state);
    sendResponse(state);
  });
  return true; // keep the channel open for the async response
});
