#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { IngestError } from "./ingest/limits.js";
import { formatText } from "./report/text.js";
import { scanFolder, scanZip } from "./scan.js";
import { VERSION } from "./version.js";

const USAGE = `repo-safety ${VERSION}
Check a folder or ZIP for auto-run traps without running any of its code.

Usage:
  repo-safety scan <folder-or-zip> [--json] [--no-color]

Exit codes: 0 safe, 1 suspicious, 2 dangerous, 3 error`;

async function main(argv: string[]): Promise<number> {
  const args = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  if (flags.has("--version")) {
    console.log(VERSION);
    return 0;
  }
  if (flags.has("--help") || args[0] !== "scan" || !args[1]) {
    console.log(USAGE);
    return args.length === 0 || flags.has("--help") ? 0 : 3;
  }

  const target = args[1];
  try {
    const st = await stat(target);
    const report = st.isDirectory() ? await scanFolder(target) : await scanZip(target);
    if (flags.has("--json")) console.log(JSON.stringify(report, null, 2));
    else console.log(formatText(report, { color: !flags.has("--no-color") && process.stdout.isTTY }));
    return report.verdict === "dangerous" ? 2 : report.verdict === "suspicious" ? 1 : 0;
  } catch (err) {
    const msg = err instanceof IngestError ? `Rejected: ${err.message}` : `Error: ${(err as Error).message}`;
    console.error(msg);
    return 3;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
