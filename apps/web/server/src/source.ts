import type { Host, RepoRef } from "./types.js";

const HOSTS: Record<string, Host> = { "github.com": "github", "gitlab.com": "gitlab", "bitbucket.org": "bitbucket" };
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9_./-]{1,200}$/;

/** Hosts we are willing to download archives from, including redirect targets. */
const DOWNLOAD_HOSTS = new Set([
  "github.com", "api.github.com", "codeload.github.com",
  "gitlab.com",
  "bitbucket.org", "api.bitbucket.org", "bbuseruploads.s3.amazonaws.com",
]);

export class SourceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "SourceError";
  }
}

/**
 * Parse a repo link like https://github.com/owner/repo/tree/main. Only the
 * three supported hosts are accepted, which also prevents the server from
 * being used to fetch arbitrary URLs (SSRF).
 */
export function parseRepoUrl(input: string): RepoRef {
  let raw = input.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) raw = `https://github.com/${raw}`; // "owner/repo" shorthand
  if (/^(github\.com|gitlab\.com|bitbucket\.org)\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceError("That doesn't look like a link. Paste something like https://github.com/owner/repo.");
  }
  const host = HOSTS[url.hostname.toLowerCase().replace(/^www\./, "")];
  if (url.protocol !== "https:" || !host || url.username || url.password || url.port) {
    throw new SourceError("Only https links to github.com, gitlab.com or bitbucket.org are supported.");
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [owner, repoRaw] = parts;
  const repo = repoRaw?.replace(/\.git$/, "");
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) {
    throw new SourceError("Couldn't find an owner and repository name in that link.");
  }
  let ref: string | undefined;
  const marker = parts.findIndex((p, i) => i >= 2 && (p === "tree" || p === "commit" || p === "src" || p === "commits"));
  if (marker !== -1) ref = parts.slice(marker + 1).join("/") || undefined;
  if (host === "gitlab" && parts[2] === "-" && parts[3] === "tree") ref = parts.slice(4).join("/") || undefined;
  if (ref && !REF.test(ref)) throw new SourceError("That branch or commit name has unsupported characters.");
  return { host, owner, repo, ...(ref ? { ref } : {}) };
}

export function repoLabel(r: RepoRef): string {
  return `${r.host}.${r.host === "bitbucket" ? "org" : "com"}/${r.owner}/${r.repo}${r.ref ? `@${r.ref}` : ""}`;
}

export function archiveUrl(r: RepoRef, commit?: string): string {
  const ref = encodeURIComponent(commit ?? r.ref ?? "HEAD");
  switch (r.host) {
    case "github":
      return `https://codeload.github.com/${r.owner}/${r.repo}/zip/${ref}`;
    case "gitlab":
      return `https://gitlab.com/${r.owner}/${r.repo}/-/archive/${ref}/${r.repo}-${ref}.zip`;
    case "bitbucket":
      return `https://bitbucket.org/${r.owner}/${r.repo}/get/${ref}.zip`;
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Resolve a branch/tag to a commit SHA so reports can be cached per commit. */
export async function resolveCommit(r: RepoRef, opts: { fetch?: FetchLike; githubToken?: string } = {}): Promise<string | undefined> {
  const f = opts.fetch ?? fetch;
  const ref = encodeURIComponent(r.ref ?? "HEAD");
  try {
    if (r.host === "github") {
      const res = await f(`https://api.github.com/repos/${r.owner}/${r.repo}/commits/${ref}`, {
        headers: { accept: "application/vnd.github.sha", "user-agent": "repo-safety", ...(opts.githubToken ? { authorization: `Bearer ${opts.githubToken}` } : {}) },
      });
      if (res.status === 404 || res.status === 422) throw new SourceError("Repository or branch not found (private repos aren't supported yet).", 404);
      if (!res.ok) return undefined;
      const sha = (await res.text()).trim();
      return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
    }
    if (r.host === "gitlab") {
      const res = await f(`https://gitlab.com/api/v4/projects/${encodeURIComponent(`${r.owner}/${r.repo}`)}/repository/commits/${r.ref ? ref : "HEAD"}`);
      if (res.status === 404) throw new SourceError("Repository or branch not found (private repos aren't supported yet).", 404);
      if (!res.ok) return undefined;
      const id = ((await res.json()) as { id?: string }).id;
      return id && /^[0-9a-f]{40}$/.test(id) ? id : undefined;
    }
    const res = await f(`https://api.bitbucket.org/2.0/repositories/${r.owner}/${r.repo}/commit/${r.ref ? ref : "HEAD"}`);
    if (res.status === 404) throw new SourceError("Repository or branch not found (private repos aren't supported yet).", 404);
    if (!res.ok) return undefined;
    const hash = ((await res.json()) as { hash?: string }).hash;
    return hash && /^[0-9a-f]{40}$/.test(hash) ? hash : undefined;
  } catch (err) {
    if (err instanceof SourceError) throw err;
    return undefined; // network trouble: scan anyway, just without per-commit caching
  }
}

/**
 * Download an archive with a hard byte cap. Redirects are followed by hand
 * so every hop is checked against the host allowlist.
 */
export async function downloadArchive(url: string, maxBytes: number, opts: { fetch?: FetchLike; githubToken?: string } = {}): Promise<Buffer> {
  const f = opts.fetch ?? fetch;
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(current);
    if (u.protocol !== "https:" || !DOWNLOAD_HOSTS.has(u.hostname)) throw new SourceError(`Refusing to download from ${u.hostname}.`);
    const headers: Record<string, string> = { "user-agent": "repo-safety" };
    if (opts.githubToken && u.hostname.endsWith("github.com")) headers.authorization = `Bearer ${opts.githubToken}`;
    const res = await f(current, { redirect: "manual", headers });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new SourceError("Download redirected without a location.", 502);
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status === 404) throw new SourceError("Repository or branch not found (private repos aren't supported yet).", 404);
    if (!res.ok || !res.body) throw new SourceError(`Download failed (HTTP ${res.status}).`, 502);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new SourceError(`Repository archive is larger than ${Math.round(maxBytes / 1048576)} MB.`, 413);

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SourceError(`Repository archive is larger than ${Math.round(maxBytes / 1048576)} MB.`, 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new SourceError("Too many redirects.", 502);
}
