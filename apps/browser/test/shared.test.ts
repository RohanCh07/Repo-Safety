import { describe, expect, it } from "vitest";
import { actionBadge, badgeLabel, repoFromPath } from "../src/shared.js";

describe("repoFromPath", () => {
  it.each([
    ["/acme/take-home", { owner: "acme", repo: "take-home" }],
    ["/acme/take-home/", { owner: "acme", repo: "take-home" }],
    ["/acme/take-home/tree/dev", { owner: "acme", repo: "take-home", ref: "dev" }],
    ["/acme/take-home/blob/main/README.md", { owner: "acme", repo: "take-home" }],
    ["/acme/take-home/pulls", { owner: "acme", repo: "take-home" }],
  ])("%s", (path, want) => expect(repoFromPath(path)).toEqual(want));

  it.each(["/", "/acme", "/settings/profile", "/orgs/acme/repositories", "/marketplace/actions", "/search?q=x", "/<script>/x"])("ignores %s", (path) => {
    expect(repoFromPath(path)).toBeUndefined();
  });
});

describe("badge text", () => {
  it("shows verdict and score", () => {
    expect(badgeLabel({ verdict: "dangerous", score: 82 }).text).toBe("Repo-Safety: Dangerous (82/100)");
    expect(badgeLabel({ verdict: "safe" }).title).toMatch(/can't guarantee/);
    expect(actionBadge("dangerous")).toEqual({ text: "!", color: "#c0262d" });
  });
});
