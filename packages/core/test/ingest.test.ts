import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IngestError, readFolder, readZipBuffer, resolveLimits, safeRelativePath } from "../src/index.js";
import { buildZip } from "./helpers.js";

const limits = resolveLimits();

async function rejected(p: Promise<unknown>): Promise<IngestError> {
  const err = await p.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(IngestError);
  return err as IngestError;
}

describe("safeRelativePath", () => {
  it.each(["../evil", "a/../../evil", "/etc/passwd", "C:/Windows/x", "a\\..\\..\\x", "a\0b"])("rejects %j", (p) => {
    expect(() => safeRelativePath(p, 32)).toThrow(IngestError);
  });
  it("normalizes harmless paths", () => {
    expect(safeRelativePath("./a//b/./c.txt", 32)).toBe("a/b/c.txt");
    expect(safeRelativePath("a\\b.txt", 32)).toBe("a/b.txt");
  });
});

describe("readZipBuffer", () => {
  it("rejects zip-slip paths", async () => {
    const err = await rejected(readZipBuffer(buildZip([{ name: "../../evil.sh", data: "echo hello" }]), limits));
    expect(err.code).toBe("unsafe-path");
  });

  it("rejects absolute paths", async () => {
    const err = await rejected(readZipBuffer(buildZip([{ name: "/tmp/evil.sh", data: "echo hello" }]), limits));
    expect(err.code).toBe("unsafe-path");
  });

  it("rejects entries with extreme compression ratios (zip bomb)", async () => {
    const zeros = Buffer.alloc(50 * 1024 * 1024);
    const err = await rejected(readZipBuffer(buildZip([{ name: "bomb.txt", data: zeros }]), limits));
    expect(err.code).toBe("zip-bomb");
  });

  it("does not trust sizes claimed in headers", async () => {
    const data = Buffer.alloc(3 * 1024 * 1024, "a");
    const zip = buildZip([{ name: "liar.txt", data, claimedSize: 10 }]);
    const err = await rejected(readZipBuffer(zip, resolveLimits({ maxCompressionRatio: 1e9 })));
    expect(["zip-bomb", "invalid-archive"]).toContain(err.code);
  });

  it("rejects archives with too many entries", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, data: "x" }));
    const err = await rejected(readZipBuffer(buildZip(entries), resolveLimits({ maxEntries: 10 })));
    expect(err.code).toBe("too-many-entries");
  });

  it("rejects non-zip data", async () => {
    const err = await rejected(readZipBuffer(Buffer.from("not a zip"), limits));
    expect(err.code).toBe("invalid-archive");
  });

  it("strips the single top-level folder GitHub adds", async () => {
    const files = await readZipBuffer(buildZip([{ name: "repo-main/" }, { name: "repo-main/.vscode/tasks.json", data: "{}" }, { name: "repo-main/a.txt", data: "a" }]), limits);
    expect(files.map((f) => f.path).sort()).toEqual([".vscode/tasks.json", "a.txt"]);
  });

  it("records symlinks without following them", async () => {
    const files = await readZipBuffer(buildZip([{ name: "link", data: "/etc/passwd", symlink: true }]), limits);
    expect(files[0]).toMatchObject({ path: "link", isSymlink: true, linkTarget: "/etc/passwd" });
    expect(files[0]!.content).toBeUndefined();
  });

  it("lists oversized files without loading them", async () => {
    const big = Buffer.from("x".repeat(3000));
    const files = await readZipBuffer(buildZip([{ name: "big.txt", data: big }]), resolveLimits({ maxFileBytes: 1000 }));
    expect(files[0]).toMatchObject({ skipped: "too-large" });
    expect(files[0]!.content).toBeUndefined();
  });

  it("marks binary files", async () => {
    const files = await readZipBuffer(buildZip([{ name: "img.bin", data: Buffer.from([0, 1, 2, 3, 0, 255]) }]), limits);
    expect(files[0]).toMatchObject({ isBinary: true, skipped: "binary" });
  });
});

describe("readFolder", () => {
  const dirs: string[] = [];
  afterAll(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  it("never follows symlinks out of the folder", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "rs-outside-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "rs-root-"));
    dirs.push(outside, root);
    await writeFile(path.join(outside, "secret.txt"), "TOP SECRET");
    await symlink(outside, path.join(root, "linked-dir"));
    await symlink(path.join(outside, "secret.txt"), path.join(root, "linked-file"));
    const files = await readFolder(root, limits);
    expect(files.every((f) => !f.content?.includes("TOP SECRET"))).toBe(true);
    expect(files.filter((f) => f.isSymlink)).toHaveLength(2);
  });

  it("skips node_modules and git objects but reads .git/hooks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rs-git-"));
    dirs.push(root);
    await mkdir(path.join(root, "node_modules/x"), { recursive: true });
    await mkdir(path.join(root, ".git/objects/ab"), { recursive: true });
    await mkdir(path.join(root, ".git/hooks"), { recursive: true });
    await writeFile(path.join(root, "node_modules/x/index.js"), "x");
    await writeFile(path.join(root, ".git/objects/ab/cd"), "x");
    await writeFile(path.join(root, ".git/hooks/pre-commit"), "#!/bin/sh\necho hello\n");
    const paths = (await readFolder(root, limits)).map((f) => f.path);
    expect(paths).toEqual([".git/hooks/pre-commit"]);
  });

  it("rejects a missing folder", async () => {
    const err = await rejected(readFolder("/definitely/not/here", limits));
    expect(err.code).toBe("not-found");
  });
});
