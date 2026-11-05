/** How serious a single finding is. */
export type Severity = "info" | "suspicious" | "dangerous";

/** The overall answer for a scanned repository. */
export type Verdict = "safe" | "suspicious" | "dangerous";

/** One file from the scanned repository, read without executing anything. */
export interface ScannedFile {
  /** Normalized, forward-slash path relative to the repository root. */
  path: string;
  /** Size in bytes, as read (not as claimed by an archive header). */
  size: number;
  /** UTF-8 text content. Undefined for binary or skipped files. */
  content?: string;
  /** True when the file looks like binary data. */
  isBinary: boolean;
  /** True when the entry is a symbolic link. Links are never followed. */
  isSymlink: boolean;
  /** For symlinks, the link target as stored in the repo. */
  linkTarget?: string;
  /** Why content was not loaded, if it wasn't. */
  skipped?: "too-large" | "binary" | "symlink";
}

/** Something a rule noticed. */
export interface Finding {
  ruleId: string;
  severity: Severity;
  /** Short headline, e.g. "Task runs automatically when the folder opens". */
  title: string;
  /** Plain-English explanation aimed at a junior developer. */
  explanation: string;
  /** What the user should do about it. */
  recommendation?: string;
  file: string;
  /** 1-based line number, when known. */
  line?: number;
  /** The relevant line(s) of the file, trimmed. */
  snippet?: string;
}

/** Context passed to every rule. */
export interface RuleContext {
  files: ScannedFile[];
  /** Fast lookup by normalized path. */
  byPath: Map<string, ScannedFile>;
  /** Where the files came from. Some traps only matter for archives. */
  source: "folder" | "zip";
}

export interface Rule {
  id: string;
  title: string;
  description: string;
  check(ctx: RuleContext): Finding[];
}

export interface ScanStats {
  filesSeen: number;
  filesRead: number;
  bytesRead: number;
  skippedLarge: number;
  skippedBinary: number;
  symlinks: number;
  durationMs: number;
}

export interface ScanReport {
  tool: { name: "repo-safety"; version: string };
  target: string;
  source: "folder" | "zip";
  verdict: Verdict;
  score: number;
  summary: string;
  findings: Finding[];
  counts: Record<Severity, number>;
  stats: ScanStats;
  disclaimer: string;
}
