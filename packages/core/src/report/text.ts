import type { ScanReport, Severity } from "../types.js";

const COLORS = { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };

/** Human-readable report for terminals. */
export function formatText(report: ScanReport, opts: { color?: boolean } = {}): string {
  const c = (code: keyof typeof COLORS, s: string) => (opts.color ? `${COLORS[code]}${s}${COLORS.reset}` : s);
  const sevColor: Record<Severity, keyof typeof COLORS> = { dangerous: "red", suspicious: "yellow", info: "dim" };
  const verdictColor = report.verdict === "dangerous" ? "red" : report.verdict === "suspicious" ? "yellow" : "green";

  const out: string[] = [];
  out.push(c("bold", `Repo-Safety scan: ${report.target}`));
  out.push(`${c(verdictColor, c("bold", report.verdict.toUpperCase()))}  (risk score ${report.score}/100)`);
  out.push(report.summary);
  out.push("");

  report.findings.forEach((f, i) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    out.push(`${i + 1}. ${c(sevColor[f.severity], `[${f.severity.toUpperCase()}]`)} ${c("bold", f.title)}`);
    out.push(`   ${c("dim", loc)}`);
    if (f.snippet) out.push(`   ${c("dim", "│")} ${f.snippet}`);
    out.push(`   ${f.explanation}`);
    if (f.recommendation) out.push(`   ${c("bold", "What to do:")} ${f.recommendation}`);
    out.push("");
  });

  const s = report.stats;
  out.push(c("dim", `Checked ${s.filesRead} of ${s.filesSeen} files in ${s.durationMs} ms` +
    (s.skippedLarge ? `, ${s.skippedLarge} too large to read` : "") +
    (s.skippedBinary ? `, ${s.skippedBinary} binary` : "") + "."));
  out.push(c("dim", report.disclaimer));
  return out.join("\n");
}
