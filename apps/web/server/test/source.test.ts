import { describe, expect, it } from "vitest";
import { archiveUrl, downloadArchive, parseRepoUrl, SourceError } from "../src/source.js";

describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/acme/take-home", { host: "github", owner: "acme", repo: "take-home" }],
    ["github.com/acme/take-home.git", { host: "github", owner: "acme", repo: "take-home" }],
    ["acme/take-home", { host: "github", owner: "acme", repo: "take-home" }],
    ["https://github.com/acme/take-home/tree/feature/x", { host: "github", owner: "acme", repo: "take-home", ref: "feature/x" }],
    ["https://gitlab.com/acme/app/-/tree/dev", { host: "gitlab", owner: "acme", repo: "app", ref: "dev" }],
    ["https://bitbucket.org/acme/app/src/main/", { host: "bitbucket", owner: "acme", repo: "app", ref: "main" }],
  ])("%s", (input, want) => {
    expect(parseRepoUrl(input)).toEqual(want);
  });

  it.each([
    "http://github.com/a/b",
    "https://evil.example/a/b",
    "https://github.com.evil.example/a/b",
    "https://user:pass@github.com/a/b",
    "https://github.com:8443/a/b",
    "https://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "https://github.com/only-owner",
    "https://github.com/a/b/tree/$(rm -rf)",
  ])("rejects %s", (input) => {
    expect(() => parseRepoUrl(input)).toThrow(SourceError);
  });
});

describe("downloadArchive", () => {
  const res = (status: number, body?: string, headers: Record<string, string> = {}) => new Response(body ?? null, { status, headers });

  it("follows redirects only to allowed hosts", async () => {
    const fetch = async (url: string) => (url.includes("codeload") ? res(302, undefined, { location: "https://169.254.169.254/x" }) : res(200, "x"));
    await expect(downloadArchive(archiveUrl({ host: "github", owner: "a", repo: "b" }), 1000, { fetch })).rejects.toThrow(/Refusing to download/);
  });

  it("stops downloading once the size cap is passed", async () => {
    const fetch = async () => res(200, "x".repeat(5000));
    await expect(downloadArchive("https://codeload.github.com/a/b/zip/HEAD", 1000, { fetch })).rejects.toThrow(/larger than/);
  });

  it("reports missing repos clearly", async () => {
    const fetch = async () => res(404);
    await expect(downloadArchive("https://codeload.github.com/a/b/zip/HEAD", 1000, { fetch })).rejects.toThrow(/not found/);
  });
});
