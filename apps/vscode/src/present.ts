import type { Finding, ScanReport, Severity, Verdict } from "@repo-safety/core";

/** Editor-agnostic description of a diagnostic, so it can be unit tested without VS Code. */
export interface DiagnosticSpec {
  file: string;
  /** 0-based line. */
  line: number;
  level: "error" | "warning" | "information";
  message: string;
  code: string;
}

const LEVEL: Record<Severity, DiagnosticSpec["level"]> = { dangerous: "error", suspicious: "warning", info: "information" };

export function toDiagnosticSpecs(report: ScanReport): DiagnosticSpec[] {
  return report.findings
    .filter((f) => f.file)
    .map((f: Finding) => ({
      file: f.file,
      line: Math.max(0, (f.line ?? 1) - 1),
      level: LEVEL[f.severity],
      message: `${f.title}. ${f.explanation}${f.recommendation ? `\nWhat to do: ${f.recommendation}` : ""}`,
      code: f.ruleId,
    }));
}

export function statusText(verdict: Verdict | "scanning" | "error"): { text: string; tooltip: string } {
  switch (verdict) {
    case "dangerous":
      return { text: "$(error) Repo-Safety: Dangerous", tooltip: "Traps found that can run code on your computer. Click for details." };
    case "suspicious":
      return { text: "$(warning) Repo-Safety: Suspicious", tooltip: "Items worth checking before you trust or install this project." };
    case "safe":
      return { text: "$(shield) Repo-Safety: No traps found", tooltip: "No known traps found. This lowers risk but cannot guarantee safety." };
    case "scanning":
      return { text: "$(sync~spin) Repo-Safety: Scanning…", tooltip: "Checking this folder without running any of its code." };
    default:
      return { text: "$(circle-slash) Repo-Safety: Scan failed", tooltip: "The scan could not finish. Click to see why." };
  }
}

/** The notification shown after a scan. Undefined means stay quiet. */
export function notification(report: ScanReport, trusted: boolean): { kind: "error" | "warning"; message: string } | undefined {
  const n = report.counts.dangerous;
  if (report.verdict === "dangerous") {
    return {
      kind: "error",
      message: trusted
        ? `Repo-Safety found ${n} trap${n === 1 ? "" : "s"} in this trusted folder that can run code on your computer. Review them now.`
        : `Repo-Safety found ${n} trap${n === 1 ? "" : "s"} that can run code on your computer. Do NOT trust this folder.`,
    };
  }
  if (report.verdict === "suspicious") {
    return { kind: "warning", message: `Repo-Safety found ${report.counts.suspicious} item(s) worth checking before you trust or install this project.` };
  }
  return undefined;
}
