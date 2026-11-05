import type { Finding, Rule } from "../types.js";
import { findLine, isVendored, lineText, riskyCommandReasons } from "./util.js";

/** setup.py code that runs commands or fetches things while pip installs the package. */
const SETUP_EXEC = /\b(os\.system|os\.popen|subprocess\.\w+|exec\s*\(|eval\s*\(|__import__\s*\(|urllib\.request|urlopen\s*\(|requests\.(get|post)|socket\.socket|ctypes\.)/;
/** Custom install/develop/egg_info commands run arbitrary code during `pip install`. */
const SETUP_CMDCLASS = /\bcmdclass\s*=|class\s+\w+\(\s*(install|develop|egg_info|build_py|sdist|bdist_wheel)\s*\)/;

/**
 * Python packages run code at install time through setup.py, an in-tree
 * build backend, or `.pth` files (which run on every Python start).
 */
export const pythonInstallRule: Rule = {
  id: "python-install-hook",
  title: "Python code that runs on pip install",
  description: "Finds setup.py commands, in-tree build backends and .pth files that run code when a package is installed.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (isVendored(file.path) || !file.content || /(^|\/)(site-packages|\.venv|venv|\.tox)\//.test(file.path)) continue;
      const c = file.content;

      if (/(^|\/)setup\.py$/.test(file.path)) {
        const exec = findLine(c, SETUP_EXEC);
        const cmd = findLine(c, SETUP_CMDCLASS);
        const hit = exec ?? cmd;
        if (!hit) continue;
        const reasons = riskyCommandReasons(c);
        const dangerous = !!exec && reasons.length > 0;
        findings.push({
          ruleId: "python-install-hook",
          severity: dangerous ? "dangerous" : "suspicious",
          title: dangerous ? "setup.py runs a risky command during install" : "setup.py runs custom code during install",
          explanation:
            `${file.path} ${exec ? "runs commands or network calls" : "replaces pip's install steps with its own code"}, and pip runs that automatically on \`pip install .\`.` +
            (reasons.length ? ` The file ${reasons.join(", ")}.` : ""),
          recommendation: "Read setup.py before installing, or install inside a disposable container.",
          file: file.path,
          ...hit,
        });
      }

      if (/(^|\/)pyproject\.toml$/.test(file.path)) {
        const backendPath = findLine(c, /^\s*backend-path\s*=/);
        if (backendPath) {
          findings.push({
            ruleId: "python-install-hook",
            severity: "suspicious",
            title: "Package builds itself with code from inside the repo",
            explanation: `${file.path} sets "backend-path", so pip runs a build backend shipped in this repo when you install it.`,
            recommendation: "Check the files under backend-path before running pip install.",
            file: file.path,
            ...backendPath,
          });
        }
      }

      if (/\.pth$/.test(file.path)) {
        const imp = findLine(c, /^\s*import\s/);
        if (imp) {
          findings.push({
            ruleId: "python-install-hook",
            severity: "dangerous",
            title: "Python .pth file runs code on every Python start",
            explanation: `${file.path} starts with "import". If it is installed into site-packages, Python runs it every time any Python program starts.`,
            recommendation: "Delete this file. Normal projects do not ship executable .pth files.",
            file: file.path,
            line: imp.line,
            snippet: lineText(c, imp.line),
          });
        }
      }
    }
    return findings;
  },
};
