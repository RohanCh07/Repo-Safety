import type { Finding, Rule } from "../types.js";
import { basename, findLine, lineText } from "./util.js";

/**
 * Git config keys that make git run a program. Git does not copy these with
 * `git clone`, but they survive inside a ZIP or a copied folder.
 */
const EXEC_CONFIG = /^\s*(hooksPath|fsmonitor|sshCommand|pager|editor|askPass|external|textconv|clean|smudge|process|gpgProgram|program|helper)\s*=/i;
const ALIAS_SHELL = /^\s*[\w.-]+\s*=\s*!/;

/**
 * Real git hooks (pre-commit, post-checkout, ...) in `.git/hooks` run on
 * ordinary git commands. They never arrive via `git clone`, so any non-sample
 * hook in an upload was put there on purpose.
 */
export const gitHooksRule: Rule = {
  id: "git-hooks",
  title: "Git hooks and git config that run programs",
  description: "Finds .git/hooks scripts and .git/config settings that run commands during normal git use.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      const hook = file.path.match(/(^|\/)\.git\/hooks\/([^/]+)$/);
      if (hook) {
        const name = hook[2]!;
        if (name.endsWith(".sample")) continue;
        // Hooks that git-lfs installs into every clone it touches.
        if (file.content && /^#!\/bin\/sh\s*\n(command -v git-lfs[^\n]*\n)?[\s\S]{0,300}git lfs (post-checkout|post-commit|post-merge|pre-push) "\$@"\s*$/.test(file.content)) continue;
        // In an archive, hooks were put there on purpose. In a local folder
        // they may come from the user's own tools, so they're "suspicious".
        const fromArchive = ctx.source === "zip";
        const firstLine = file.content ? lineText(file.content, 1) : undefined;
        findings.push({
          ruleId: "git-hooks",
          severity: fromArchive ? "dangerous" : "suspicious",
          title: `Git hook "${name}" is included`,
          explanation:
            `${fromArchive ? "This archive contains" : "This folder has"} .git/hooks/${name}. Git runs this script automatically during normal commands ` +
            `(for example "${hookTrigger(name)}"). ` +
            (fromArchive
              ? "Hooks are never copied by git clone, so someone put it there on purpose."
              : "If you downloaded this folder rather than cloning it yourself, someone put it there on purpose."),
          recommendation: "Delete the .git/hooks folder (or the whole .git folder) before running any git command in this project.",
          file: file.path,
          ...(firstLine ? { line: 1, snippet: firstLine } : {}),
        });
        continue;
      }

      if (/(^|\/)\.git\/config$/.test(file.path) && file.content) {
        const lines = file.content.split(/\r?\n/);
        let section = "";
        lines.forEach((text, i) => {
          const sec = text.match(/^\s*\[([^\]]+)\]/);
          if (sec) {
            section = sec[1]!.toLowerCase();
            return;
          }
          const isAlias = section.startsWith("alias") && ALIAS_SHELL.test(text);
          const isExec = EXEC_CONFIG.test(text) && !/^\s*(editor|pager)\s*=\s*(vim?|nano|less|more|code(\s+--wait)?)\s*$/i.test(text);
          if (!isAlias && !isExec) return;
          findings.push({
            ruleId: "git-hooks",
            severity: "dangerous",
            title: isAlias ? "Git alias runs a shell command" : "Git config runs a program",
            explanation:
              `The repo's own .git/config (section [${section}]) contains ${JSON.stringify(text.trim())}. ` +
              "That makes git start a program during everyday commands such as git status or git commit. Git clone never copies this file.",
            recommendation: "Delete the .git folder from this download, then clone the repo fresh from its URL if you need history.",
            file: file.path,
            line: i + 1,
            snippet: lineText(file.content!, i + 1),
          });
        });
      }

      // Hooks folders that tools like husky install from the repo itself.
      if (/(^|\/)\.husky\/[^/_][^/]*$/.test(file.path) && file.content && !/\.husky\/\.gitignore$/.test(file.path)) {
        const risky = findLine(file.content, /\b(curl|wget|base64|eval|powershell|iwr)\b|\|\s*(ba)?sh\b/i);
        if (risky) {
          findings.push({
            ruleId: "git-hooks",
            severity: "suspicious",
            title: `Husky hook "${basename(file.path)}" runs a risky command`,
            explanation: "Husky installs this script as a git hook when you run npm install, then git runs it on every commit.",
            recommendation: "Read this hook before running npm install, or install with --ignore-scripts.",
            file: file.path,
            ...risky,
          });
        }
      }
    }
    return findings;
  },
};

function hookTrigger(name: string): string {
  if (name.includes("commit")) return "git commit";
  if (name.includes("checkout")) return "git checkout";
  if (name.includes("merge")) return "git merge or git pull";
  if (name.includes("push")) return "git push";
  if (name.includes("rebase")) return "git rebase";
  if (name === "fsmonitor-watchman") return "git status";
  return "git commit or git checkout";
}
