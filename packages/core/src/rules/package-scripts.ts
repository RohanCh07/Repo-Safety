import type { Finding, Rule } from "../types.js";
import { isObject, isVendored, locate, parseJsonc, quote, riskyCommandReasons, strongRiskReasons, TEST_PATH } from "./util.js";

/** Scripts npm, yarn and pnpm run by themselves during `install`. */
const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare"];

/** Common, harmless install-time scripts that should not raise alarms. */
const KNOWN_BENIGN = /^\s*(husky(\s+install)?|husky\s+\S+|patch-package(\s+--?[\w-]+(\s+\w+)?)*|opencollective(-postinstall)?(\s+postinstall)?|node-gyp\s+rebuild|prebuild-install(\s|$)|tsc(\s|$)|(npm|pnpm|yarn)\s+(run\s+)?build|npx\s+only-allow\s+[\w-]+|ngcc|lefthook\s+install|simple-git-hooks|is-ci\s*\|\|\s*husky(\s+install)?|svelte-kit\s+sync|nuxt\s+prepare|panda\s+codegen|prisma\s+generate)\s*$/i;

/**
 * package.json lifecycle scripts run automatically on `npm install`.
 * They are common in legit projects, so they are "suspicious" on their own
 * and "dangerous" when the command downloads, decodes or hides code.
 */
export const packageScriptsRule: Rule = {
  id: "npm-lifecycle-script",
  title: "npm install scripts",
  description: "Finds package.json scripts that run automatically on install, and other scripts with risky commands.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (isVendored(file.path) || TEST_PATH.test(file.path) || !/(^|\/)package\.json$/.test(file.path)) continue;
      const doc = parseJsonc(file);
      if (!doc || !isObject(doc.value) || !isObject(doc.value["scripts"])) continue;
      const scripts = doc.value["scripts"];

      for (const [name, raw] of Object.entries(scripts)) {
        if (typeof raw !== "string") continue;
        const command = raw;
        const reasons = riskyCommandReasons(command);
        // A script that runs a JS file: look inside that file too.
        const scriptFile = referencedFile(command, file.path, ctx.byPath);
        const fileReasons = scriptFile?.content ? riskyCommandReasons(scriptFile.content) : [];
        const auto = INSTALL_HOOKS.includes(name);
        const where = locate(doc, ["scripts", name]);

        if (auto) {
          if (!reasons.length && !fileReasons.length && KNOWN_BENIGN.test(command)) continue;
          const dangerous = reasons.length > 0 || fileReasons.length > 0;
          findings.push({
            ruleId: "npm-lifecycle-script",
            severity: dangerous ? "dangerous" : "suspicious",
            title: dangerous ? "Install script runs a risky command" : "Script runs automatically on npm install",
            explanation:
              `The "${name}" script runs ${quote(command)} automatically when you run npm install (or yarn / pnpm install).` +
              (reasons.length ? ` The command ${reasons.join(", ")}.` : "") +
              (fileReasons.length ? ` The file it runs, ${scriptFile!.path}, ${fileReasons.join(", ")}.` : "") +
              (dangerous ? "" : " Many real projects have install scripts, so check what it does rather than panicking."),
            recommendation: "Install with `npm install --ignore-scripts`, or read the script and any file it runs first.",
            file: file.path,
            ...where,
          });
        } else if (strongRiskReasons(command).length) {
          findings.push({
            ruleId: "npm-lifecycle-script",
            severity: "suspicious",
            title: "npm script runs a risky command",
            explanation:
              `The "${name}" script runs ${quote(command)}, which ${reasons.join(", ")}. ` +
              `It only runs when someone types \`npm run ${name}\`, but take-home tests usually tell you to do exactly that.`,
            recommendation: "Read what this script does before running it.",
            file: file.path,
            ...where,
          });
        }
      }
    }
    return findings;
  },
};

/** For `node scripts/setup.js` style commands, return the referenced file. */
function referencedFile(command: string, pkgPath: string, byPath: Map<string, import("../types.js").ScannedFile>) {
  const m = command.match(/\b(?:node|bun|deno\s+run|tsx|ts-node|sh|bash)\s+(?:--?\S+\s+)*["']?([\w./@-]+\.(?:c?js|mjs|ts|sh))["']?/);
  if (!m) return undefined;
  const dir = pkgPath.includes("/") ? pkgPath.slice(0, pkgPath.lastIndexOf("/") + 1) : "";
  const rel = (dir + m[1]!).replace(/(^|\/)\.\//g, "$1");
  return byPath.get(rel);
}
