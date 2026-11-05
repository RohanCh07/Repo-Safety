import type { ScanReport } from "@repo-safety/core";

export type Host = "github" | "gitlab" | "bitbucket";

export interface RepoRef {
  host: Host;
  owner: string;
  repo: string;
  /** Branch, tag or commit. Undefined means the default branch. */
  ref?: string;
}

export type ScanStatus = "queued" | "running" | "done" | "failed";

export interface ScanRecord {
  id: string;
  status: ScanStatus;
  /** What the user asked to scan, shown on the report page. */
  target: string;
  /** e.g. "github:owner/repo@<sha>", used to reuse reports for the same commit. */
  cacheKey?: string;
  engineVersion: string;
  report?: ScanReport;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ScanJob =
  | { id: string; kind: "repo"; repo: RepoRef; commit?: string }
  | { id: string; kind: "upload"; uploadKey: string; fileName: string };
