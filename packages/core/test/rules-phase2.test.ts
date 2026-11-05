import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanFolder } from "../src/index.js";
import { lookalikeOf } from "../src/rules/dependencies.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bad = (name: string) => scanFolder(path.join(here, "fixtures/malicious-like", name));

describe("phase 2 rules", () => {
  it("setup.py that runs a command on install", async () => {
    const r = await bad("python-setup");
    expect(r.findings[0]).toMatchObject({ ruleId: "python-install-hook", file: "setup.py", line: 5 });
  });

  it("Terraform external data source", async () => {
    const r = await bad("terraform-external");
    expect(r.verdict).toBe("dangerous");
    expect(r.findings[0]).toMatchObject({ ruleId: "build-script-exec", file: "main.tf", line: 2 });
  });

  it("code hidden off-screen with whitespace", async () => {
    const r = await bad("hidden-offscreen-code");
    expect(r.verdict).toBe("dangerous");
    expect(r.findings[0]).toMatchObject({ ruleId: "obfuscated-code", file: "src/app.js", line: 2 });
    expect(r.findings[0]!.snippet).toContain("hidden code");
  });

  it("eval on data fetched at runtime", async () => {
    const r = await bad("eval-remote-payload");
    expect(r.verdict).toBe("dangerous");
    expect(r.findings[0]).toMatchObject({ ruleId: "obfuscated-code", file: "server/config.js", line: 6 });
  });

  it("typosquatted and URL dependencies", async () => {
    const r = await bad("typosquat-deps");
    expect(r.verdict).toBe("suspicious");
    const lines = r.findings.map((f) => `${f.line}:${f.title}`);
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^6:.*typo/), expect.stringMatching(/^8:.*URL/)]));
    expect(r.findings).toHaveLength(2);
  });

  it("JetBrains startup task", async () => {
    const r = await bad("jetbrains-startup");
    expect(r.findings[0]).toMatchObject({ ruleId: "jetbrains-startup-task", severity: "dangerous", line: 4 });
  });

  it("shell script that downloads and runs code", async () => {
    const r = await bad("shell-download-run");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ ruleId: "build-script-exec", severity: "suspicious", file: "install.sh", line: 5 });
  });
});

describe("lookalikeOf", () => {
  it.each([["expresss", "express"], ["lodahs", "lodash"], ["axois", "axios"], ["react_dom", "react-dom"], ["reqeusts", undefined]])("%s", (name, want) => {
    if (want === undefined) expect(lookalikeOf(name, ["express", "lodash", "axios", "react-dom"])).toBeUndefined();
    else expect(lookalikeOf(name, ["express", "lodash", "axios", "react-dom"])).toBe(want);
  });
  it("does not flag the real names", () => {
    expect(lookalikeOf("express", ["express"])).toBeUndefined();
  });
});
