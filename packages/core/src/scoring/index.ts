import type { Finding, Severity, Verdict } from "../types.js";

const ORDER: Record<Severity, number> = { dangerous: 0, suspicious: 1, info: 2 };

/**
 * Overall verdict. One dangerous finding is enough for "dangerous": a single
 * auto-run trap is all an attacker needs.
 */
export function verdictFor(findings: Finding[]): Verdict {
  if (findings.some((f) => f.severity === "dangerous")) return "dangerous";
  if (findings.some((f) => f.severity === "suspicious")) return "suspicious";
  return "safe";
}

/**
 * 0 (nothing found) to 100 (very likely a trap). Suspicious-only repos stay
 * below 60 however many findings they have, so lots of ordinary install
 * scripts never look as bad as one real auto-run trap.
 */
export function riskScore(findings: Finding[]): number {
  const { dangerous, suspicious } = countBySeverity(findings);
  if (dangerous > 0) return Math.min(100, 70 + 10 * (dangerous - 1) + 2 * suspicious);
  if (suspicious > 0) return Math.min(60, 20 + 5 * (suspicious - 1));
  return 0;
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { dangerous: 0, suspicious: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/** Most severe first, then by file and line, so reports are stable. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}
