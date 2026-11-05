import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanFolder, scanZipBuffer } from "../src/index.js";
import { buildZip } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bad = (name: string) => path.join(here, "fixtures/malicious-like", name);
const good = (name: string) => path.join(here, "fixtures/benign", name);

describe("malicious-like fixtures are caught with file and line", () => {
  it("VS Code task that runs on folder open", async () => {
    const r = await scanFolder(bad("vscode-folder-open"));
    expect(r.verdict).toBe("dangerous");
    expect(r.findings[0]).toMatchObject({ ruleId: "vscode-autorun-task", severity: "dangerous", file: ".vscode/tasks.json", line: 10 });
    expect(r.findings[0]!.snippet).toContain("folderOpen");
    expect(r.findings[0]!.explanation).toContain("echo hello");
  });

  it("explains risky commands inside a folder-open task", async () => {
    const r = await scanFolder(bad("vscode-folder-open-risky"));
    expect(r.verdict).toBe("dangerous");
    expect(r.findings[0]!.explanation).toMatch(/downloads something from the internet/);
    expect(r.findings[0]!.explanation).toMatch(/pipes text straight into an interpreter/);
  });

  it("settings that point an interpreter at a file shipped in the repo", async () => {
    const r = await scanFolder(bad("vscode-settings-interpreter"));
    expect(r.verdict).toBe("dangerous");
    expect(r.findings[0]).toMatchObject({ ruleId: "vscode-settings-exec", file: ".vscode/settings.json", line: 4 });
    expect(r.findings[0]!.explanation).toContain("tools/python");
  });

  it("devcontainer initializeCommand runs on the host", async () => {
    const r = await scanFolder(bad("devcontainer-initialize"));
    expect(r.verdict).toBe("dangerous");
    expect(r.findings[0]).toMatchObject({ ruleId: "devcontainer-command", file: ".devcontainer/devcontainer.json", line: 5 });
  });

  it("postinstall that runs a file which decodes base64", async () => {
    const r = await scanFolder(bad("npm-postinstall"));
    expect(r.verdict).toBe("dangerous");
    expect(r.findings[0]).toMatchObject({ ruleId: "npm-lifecycle-script", file: "package.json", line: 8 });
    expect(r.findings[0]!.explanation).toContain("scripts/setup.js");
  });

  it("plain postinstall is only suspicious", async () => {
    const r = await scanFolder(bad("npm-postinstall-plain"));
    expect(r.verdict).toBe("suspicious");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "suspicious", line: 6 });
  });

  it("git hooks and exec-capable git config inside a ZIP", async () => {
    const zip = buildZip([
      { name: "take-home-main/README.md", data: "# Task\n" },
      { name: "take-home-main/.git/hooks/pre-commit.sample", data: "#!/bin/sh\n" },
      { name: "take-home-main/.git/hooks/post-checkout", data: "#!/bin/sh\necho hello\n" },
      { name: "take-home-main/.git/config", data: "[core]\n\trepositoryformatversion = 0\n\tfsmonitor = .git/fsm.sh\n[alias]\n\tst = !echo hello\n" },
    ]);
    const r = await scanZipBuffer(zip, { label: "take-home.zip" });
    expect(r.verdict).toBe("dangerous");
    const files = r.findings.map((f) => `${f.file}:${f.line ?? ""}`);
    expect(files).toEqual(expect.arrayContaining([".git/hooks/post-checkout:1", ".git/config:3", ".git/config:5"]));
    expect(files.some((f) => f.includes(".sample"))).toBe(false);
  });

  it("symlink that points outside the project", async () => {
    const zip = buildZip([
      { name: "a/notes.txt", data: "hi" },
      { name: "a/keys", data: "../../.ssh/id_rsa", symlink: true },
    ]);
    const r = await scanZipBuffer(zip, { label: "x.zip" });
    expect(r.findings.find((f) => f.ruleId === "symlink-escape")).toMatchObject({ file: "keys", severity: "suspicious" });
  });
});

describe("benign fixtures", () => {
  it("a normal project produces no findings", async () => {
    const r = await scanFolder(good("plain-node-app"));
    expect(r.findings).toEqual([]);
    expect(r.verdict).toBe("safe");
    expect(r.score).toBe(0);
  });
});
