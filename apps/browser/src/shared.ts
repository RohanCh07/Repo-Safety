export const DEFAULT_API = "http://localhost:8080";

/** GitHub top-level paths that are not "owner/repo". */
const RESERVED = new Set([
  "about", "account", "apps", "codespaces", "collections", "contact", "copilot", "customer-stories", "dashboard", "enterprise",
  "events", "explore", "features", "issues", "login", "logout", "marketplace", "new", "notifications", "orgs", "organizations",
  "pricing", "pulls", "search", "security", "settings", "signup", "site", "sponsors", "stars", "team", "topics", "trending", "users",
]);

export interface RepoPage {
  owner: string;
  repo: string;
  /** Branch from /tree/<ref>, when present. */
  ref?: string;
}

/** Work out which repo a github.com path belongs to, if any. */
export function repoFromPath(pathname: string): RepoPage | undefined {
  const parts = pathname.split("/").filter(Boolean);
  const [owner, repo] = parts;
  if (!owner || !repo || RESERVED.has(owner.toLowerCase())) return undefined;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) return undefined;
  const ref = parts[2] === "tree" && parts[3] && /^[A-Za-z0-9_.-]+$/.test(parts[3]) ? parts[3] : undefined;
  return { owner, repo: repo.replace(/\.git$/, ""), ...(ref ? { ref } : {}) };
}

export type BadgeVerdict = "safe" | "suspicious" | "dangerous" | "scanning" | "error";

export interface BadgeState {
  verdict: BadgeVerdict;
  score?: number;
  summary?: string;
  reportUrl?: string;
  error?: string;
}

/** Text and tooltip for the badge shown on the page. */
export function badgeLabel(s: BadgeState): { text: string; title: string } {
  switch (s.verdict) {
    case "dangerous":
      return { text: `Repo-Safety: Dangerous (${s.score ?? "?"}/100)`, title: s.summary ?? "Traps found. Click for the report." };
    case "suspicious":
      return { text: `Repo-Safety: Suspicious (${s.score ?? "?"}/100)`, title: s.summary ?? "Items worth checking. Click for the report." };
    case "safe":
      return { text: "Repo-Safety: No traps found", title: "No known traps found. This lowers risk but can't guarantee safety. Click for the report." };
    case "scanning":
      return { text: "Repo-Safety: Scanning…", title: "Checking this repo without running any of its code." };
    default:
      return { text: "Repo-Safety: Unavailable", title: s.error ?? "Couldn't reach the Repo-Safety server. Check the extension options." };
  }
}

/** Toolbar icon badge: short text and colour per verdict. */
export function actionBadge(v: BadgeVerdict): { text: string; color: string } {
  return {
    dangerous: { text: "!", color: "#c0262d" },
    suspicious: { text: "?", color: "#b07000" },
    safe: { text: "✓", color: "#1d7a3e" },
    scanning: { text: "…", color: "#6b7280" },
    error: { text: "", color: "#6b7280" },
  }[v];
}

export type Message = { type: "check"; page: RepoPage };
