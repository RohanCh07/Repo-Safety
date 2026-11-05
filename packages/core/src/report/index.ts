import type { Finding, ScanReport, ScanStats, Verdict } from "../types.js";
import { VERSION } from "../version.js";
import { countBySeverity, riskScore, sortFindings, verdictFor } from "../scoring/index.js";

export const DISCLAIMER =
  "This scan looks for known traps without running any code. It lowers your risk but cannot prove a repository is safe. " +
  "When in doubt, open untrusted code only in a disposable sandbox.";

export function buildReport(target: string, source: "folder" | "zip", findings: Finding[], stats: ScanStats): ScanReport {
  const sorted = sortFindings(findings);
  const verdict = verdictFor(sorted);
  const counts = countBySeverity(sorted);
  return {
    tool: { name: "repo-safety", version: VERSION },
    target,
    source,
    verdict,
    score: riskScore(sorted),
    summary: summarize(verdict, counts.dangerous, counts.suspicious),
    findings: sorted,
    counts,
    stats,
    disclaimer: DISCLAIMER,
  };
}

function summarize(verdict: Verdict, dangerous: number, suspicious: number): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  switch (verdict) {
    case "dangerous":
      return `Dangerous: found ${plural(dangerous, "trap")} that can run code on your computer` +
        (suspicious ? ` and ${plural(suspicious, "other suspicious item")}` : "") +
        ". Do not open or install this project on your own machine.";
    case "suspicious":
      return `Suspicious: found ${plural(suspicious, "item")} worth checking before you open or install this project.`;
    default:
      return "No known traps found. Still review the code before running it.";
  }
}
