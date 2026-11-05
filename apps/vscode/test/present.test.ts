import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanFolder } from "@repo-safety/core";
import { notification, statusText, toDiagnosticSpecs } from "../src/present.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/core/test/fixtures");

describe("VS Code presentation", () => {
  it("maps a dangerous finding to an error on the right 0-based line", async () => {
    const report = await scanFolder(path.join(fixtures, "malicious-like/vscode-folder-open"));
    const [d] = toDiagnosticSpecs(report);
    expect(d).toMatchObject({ file: ".vscode/tasks.json", line: 9, level: "error", code: "vscode-autorun-task" });
    expect(statusText(report.verdict).text).toContain("Dangerous");
    expect(notification(report, false)).toMatchObject({ kind: "error" });
    expect(notification(report, false)!.message).toContain("Do NOT trust");
  });

  it("stays quiet for a clean folder", async () => {
    const report = await scanFolder(path.join(fixtures, "benign/plain-node-app"));
    expect(toDiagnosticSpecs(report)).toEqual([]);
    expect(notification(report, false)).toBeUndefined();
  });
});
