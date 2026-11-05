import { readFolder } from "./ingest/folder.js";
import { resolveLimits, type IngestLimits } from "./ingest/limits.js";
import { readZipBuffer, readZipFile } from "./ingest/zip.js";
import { buildReport } from "./report/index.js";
import { builtinRules } from "./rules/index.js";
import type { Finding, Rule, RuleContext, ScanReport, ScannedFile } from "./types.js";

export interface ScanOptions {
  limits?: Partial<IngestLimits>;
  rules?: Rule[];
  /** Shown in the report instead of the path. */
  label?: string;
}

/** Scan files that are already in memory. Nothing is executed. */
export function scanFiles(files: ScannedFile[], source: "folder" | "zip", target: string, opts: ScanOptions = {}, startedAt = Date.now()): ScanReport {
  const ctx: RuleContext = { files, byPath: new Map(files.map((f) => [f.path, f])), source };
  const findings: Finding[] = [];
  for (const rule of opts.rules ?? builtinRules) {
    try {
      findings.push(...rule.check(ctx));
    } catch (err) {
      // A broken rule must never hide other findings.
      findings.push({
        ruleId: rule.id,
        severity: "info",
        title: "A check could not finish",
        explanation: `The "${rule.title}" check failed on this repo (${(err as Error).message}). Other checks still ran.`,
        file: "",
      });
    }
  }
  return buildReport(opts.label ?? target, source, findings, {
    filesSeen: files.length,
    filesRead: files.filter((f) => f.content !== undefined).length,
    bytesRead: files.reduce((n, f) => n + (f.content !== undefined ? f.size : 0), 0),
    skippedLarge: files.filter((f) => f.skipped === "too-large").length,
    skippedBinary: files.filter((f) => f.skipped === "binary").length,
    symlinks: files.filter((f) => f.isSymlink).length,
    durationMs: Date.now() - startedAt,
  });
}

export async function scanFolder(dir: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const start = Date.now();
  const files = await readFolder(dir, resolveLimits(opts.limits));
  return scanFiles(files, "folder", dir, opts, start);
}

export async function scanZip(file: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const start = Date.now();
  const files = await readZipFile(file, resolveLimits(opts.limits));
  return scanFiles(files, "zip", file, opts, start);
}

export async function scanZipBuffer(buf: Buffer, opts: ScanOptions & { label: string }): Promise<ScanReport> {
  const start = Date.now();
  const files = await readZipBuffer(buf, resolveLimits(opts.limits));
  return scanFiles(files, "zip", opts.label, opts, start);
}
