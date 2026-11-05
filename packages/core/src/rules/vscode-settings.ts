import type { Finding, Rule, Severity } from "../types.js";
import { isObject, isVendored, locate, parseJsonc, quote, riskyCommandReasons } from "./util.js";

/** Setting names that tell VS Code or an extension which program to start. */
const EXECUTABLE_KEY =
  /(^|\.)(executablePath|executable|path|pythonPath|defaultInterpreterPath|interpreterPath|serverPath|binPath|nodePath|runtimeExecutable|runtime|command|shellPath|toolsGopath|alternateTools)$/i;
const TERMINAL_KEY = /^terminal\.integrated\.(shell|shellArgs|profiles|automationProfile|automationShell|defaultProfile)\b/i;
const TERMINAL_ENV_KEY = /^terminal\.integrated\.env\./i;
const DANGEROUS_ENV = /\b(LD_PRELOAD|DYLD_INSERT_LIBRARIES|NODE_OPTIONS|PYTHONSTARTUP|PYTHONPATH|BASH_ENV|ENV|PROMPT_COMMAND|PERL5OPT|RUBYOPT)\b/;

/**
 * If a setting value points at a file that ships with the repository,
 * return that file's path. A setting like ".venv/bin/python" is normal when
 * you create the venv yourself; it is a trap when the repo ships that file.
 */
function shippedFile(value: string, byPath: Map<string, unknown>): string | undefined {
  const v = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\$\{(workspaceFolder|workspaceRoot)(:[^}]*)?\}\/?/, "")
    .replace(/^\.\//, "");
  if (!v || v.startsWith("/") || /^[A-Za-z]:/.test(v) || v.startsWith("~") || v.startsWith("${")) return undefined;
  for (const candidate of [v, `${v}.exe`, `${v}.cmd`, `${v}.bat`, `${v}.sh`]) {
    if (byPath.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Workspace settings that make VS Code or an extension start a program from
 * inside the repo (a fake Python interpreter, linter or shell). Once the
 * folder is trusted, that program runs as soon as the extension activates.
 */
export const vscodeSettingsRule: Rule = {
  id: "vscode-settings-exec",
  title: "VS Code settings that start a program",
  description: "Finds workspace settings that point to executables inside the repo or enable automatic tasks.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (isVendored(file.path)) continue;
      const isSettings = /(^|\/)\.vscode\/settings\.json$/i.test(file.path);
      const isWorkspace = /\.code-workspace$/i.test(file.path);
      if (!isSettings && !isWorkspace) continue;
      const doc = parseJsonc(file);
      if (!doc || !isObject(doc.value)) continue;
      const settings = isWorkspace ? doc.value["settings"] : doc.value;
      const prefix = isWorkspace ? ["settings"] : [];
      if (!isObject(settings)) continue;

      for (const [key, value] of Object.entries(settings)) {
        const at = locate(doc, [...prefix, key]);
        const push = (severity: Severity, title: string, explanation: string, recommendation: string) =>
          findings.push({ ruleId: "vscode-settings-exec", severity, title, explanation, recommendation, file: file.path, ...at });

        if (key === "task.allowAutomaticTasks" && (value === "on" || value === true)) {
          push(
            "dangerous",
            "Settings allow tasks to start automatically",
            "This setting tells VS Code to run \"folderOpen\" tasks without asking you first. Repos have no normal reason to change it.",
            "Remove this setting and check .vscode/tasks.json for tasks that run on folder open.",
          );
          continue;
        }

        if (key === "typescript.tsdk" && typeof value === "string") {
          if (!/node_modules\/typescript\/lib\/?$/.test(value.replace(/\\/g, "/"))) {
            push(
              "suspicious",
              "Settings load a TypeScript server from an unusual folder",
              `"typescript.tsdk" points to ${quote(value)}. If you accept the "use workspace TypeScript version" prompt, VS Code runs code from that folder.`,
              "Decline the workspace TypeScript version prompt unless the folder is the normal node_modules/typescript/lib.",
            );
          }
          continue;
        }

        if (TERMINAL_ENV_KEY.test(key) && isObject(value)) {
          for (const [envName, envValue] of Object.entries(value)) {
            if (DANGEROUS_ENV.test(envName)) {
              push(
                "dangerous",
                "Settings inject code into every terminal",
                `"${key}" sets ${envName}=${quote(String(envValue))}. That makes every program started in the VS Code terminal load extra code first.`,
                "Remove this setting before opening a terminal in this folder.",
              );
            }
          }
          continue;
        }

        const strings = collectStrings(value);
        if (TERMINAL_KEY.test(key) || EXECUTABLE_KEY.test(key)) {
          for (const s of strings) {
            const reasons = riskyCommandReasons(s);
            const inRepo = shippedFile(s, ctx.byPath);
            if (!reasons.length && !inRepo) continue;
            push(
              "dangerous",
              TERMINAL_KEY.test(key) ? "Settings replace your terminal shell" : "Settings run a program from inside the repo",
              `"${key}" is set to ${quote(s)}. ` +
                (inRepo
                  ? `That points to ${inRepo}, a file shipped with this repo, so VS Code or an extension will run it as if it were a normal tool.`
                  : `The value ${reasons.join(", ")}.`),
              "Remove this setting, or check exactly what that file is before trusting the folder.",
            );
            break;
          }
        }
      }
    }
    return findings;
  },
};

function collectStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(collectStrings);
  if (isObject(v)) return Object.values(v).flatMap(collectStrings);
  return [];
}
