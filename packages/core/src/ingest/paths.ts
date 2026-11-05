import { IngestError } from "./limits.js";

/**
 * Normalize a path from an untrusted source and reject anything that could
 * escape the repository root (zip-slip). Returns a forward-slash relative path.
 */
export function safeRelativePath(raw: string, maxDepth: number): string {
  if (raw.includes("\0")) {
    throw new IngestError("unsafe-path", `Rejected path with a NUL byte: ${JSON.stringify(raw)}`);
  }
  const p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) {
    throw new IngestError("unsafe-path", `Rejected absolute path: ${JSON.stringify(raw)}`);
  }
  const parts: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      throw new IngestError("unsafe-path", `Rejected path that escapes the folder: ${JSON.stringify(raw)}`);
    }
    parts.push(part);
  }
  if (parts.length > maxDepth) {
    throw new IngestError("too-deep", `Path is nested deeper than ${maxDepth} folders: ${JSON.stringify(raw)}`);
  }
  return parts.join("/");
}

/**
 * GitHub/GitLab archives wrap everything in one top-level folder
 * ("repo-main/..."). Strip it so rules see ".vscode/tasks.json" at the root.
 */
export function stripCommonRoot(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  let root: string | undefined;
  for (const p of paths) {
    const slash = p.indexOf("/");
    if (slash === -1) return undefined; // a file at the top level
    const first = p.slice(0, slash);
    if (root === undefined) root = first;
    else if (root !== first) return undefined;
  }
  // Never strip ".git" or ".vscode" style folders, they are meaningful.
  if (root && root.startsWith(".")) return undefined;
  return root;
}
