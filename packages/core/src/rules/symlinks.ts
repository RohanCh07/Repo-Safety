import type { Rule } from "../types.js";
import { dirname } from "./util.js";

/**
 * A symlink that points outside the project (for example to ~/.ssh) can make
 * a tool that "only reads project files" read or upload your private files.
 */
export const symlinkRule: Rule = {
  id: "symlink-escape",
  title: "Symbolic link that points outside the project",
  description: "Finds symlinks whose target is an absolute path or climbs out of the project folder.",
  check(ctx) {
    return ctx.files
      .filter((f) => f.isSymlink && f.linkTarget !== undefined && escapes(f.path, f.linkTarget))
      .map((f) => ({
        ruleId: "symlink-escape",
        severity: "suspicious" as const,
        title: "Link points outside the project folder",
        explanation:
          `${f.path} is a symbolic link to ${JSON.stringify(f.linkTarget)}, which is outside this project. ` +
          "Opening or building the project could read or overwrite files elsewhere on your computer.",
        recommendation: "Delete the link before opening the project, unless you know why it is there.",
        file: f.path,
      }));
  },
};

function escapes(linkPath: string, target: string): boolean {
  const t = target.replace(/\\/g, "/");
  if (t.startsWith("/") || /^[A-Za-z]:/.test(t) || t.startsWith("~")) return true;
  let depth = dirname(linkPath).split("/").filter(Boolean).length;
  for (const part of t.split("/")) {
    if (part === "..") depth--;
    else if (part && part !== ".") depth++;
    if (depth < 0) return true;
  }
  return false;
}
