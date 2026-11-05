import type { Finding, Rule } from "../types.js";
import { commandToString, dirname, isObject, isVendored, locate, parseJsonc, quote, riskyCommandReasons, type JsonDoc } from "./util.js";

/**
 * VS Code tasks with `"runOptions": { "runOn": "folderOpen" }` start as soon
 * as the folder is opened and trusted. This is the trap used in the
 * "Contagious Interview" fake job campaigns.
 */
export const vscodeTasksRule: Rule = {
  id: "vscode-autorun-task",
  title: "VS Code task that runs when the folder opens",
  description: "Finds tasks in .vscode/tasks.json or .code-workspace files that run automatically or run risky commands.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (isVendored(file.path)) continue;
      const isTasks = /(^|\/)\.vscode\/tasks\.json$/i.test(file.path);
      const isWorkspace = /\.code-workspace$/i.test(file.path);
      if (!isTasks && !isWorkspace) continue;

      const doc = parseJsonc(file);
      if (!doc || !isObject(doc.value)) continue;
      const base: (string | number)[] = isWorkspace ? ["tasks"] : [];
      const container = isWorkspace ? doc.value["tasks"] : doc.value;
      if (!isObject(container)) continue;

      const atRoot = isWorkspace || dirname(dirname(file.path)) === "";
      checkTaskList(doc, container["tasks"], [...base, "tasks"], atRoot, findings);
    }
    return findings;
  },
};

function checkTaskList(doc: JsonDoc, tasks: unknown, path: (string | number)[], atRoot: boolean, out: Finding[]) {
  if (!Array.isArray(tasks)) return;
  tasks.forEach((task, i) => {
    if (!isObject(task)) return;
    const label = typeof task["label"] === "string" ? task["label"] : `task #${i + 1}`;
    const command = [task["command"], task["args"], ...["windows", "linux", "osx"].map((os) => isObject(task[os]) ? [task[os]["command"], task[os]["args"]] : undefined)]
      .map(commandToString)
      .filter(Boolean)
      .join(" ");
    const reasons = riskyCommandReasons(command);
    const runOptions = task["runOptions"];
    const runsOnOpen = isObject(runOptions) && runOptions["runOn"] === "folderOpen";

    if (runsOnOpen) {
      const where = locate(doc, [...path, i, "runOptions", "runOn"]);
      out.push({
        ruleId: "vscode-autorun-task",
        severity: atRoot ? "dangerous" : "suspicious",
        title: "Task runs automatically when the folder is opened in VS Code",
        explanation:
          `The task "${label}" is set to run on "folderOpen". As soon as you open this folder in VS Code and trust it, ` +
          `it runs ${command ? quote(command) : "a command"} on your computer without you clicking anything.` +
          (reasons.length ? ` The command ${reasons.join(", ")}.` : "") +
          (atRoot ? "" : " It sits in a subfolder, so it only fires if that subfolder is opened directly."),
        recommendation:
          "Do not trust this folder in VS Code. Delete the task or the runOptions block, or open the project only in a disposable sandbox.",
        file: doc.file.path,
        ...where,
      });
    } else if (reasons.length) {
      const where = locate(doc, [...path, i, "command"]);
      out.push({
        ruleId: "vscode-autorun-task",
        severity: "suspicious",
        title: "VS Code task runs a risky command",
        explanation:
          `The task "${label}" runs ${quote(command)}, which ${reasons.join(", ")}. ` +
          "It does not start by itself, but it would run if you or a README step tells you to run this task.",
        recommendation: "Read exactly what this command does before running the task.",
        file: doc.file.path,
        ...where,
      });
    }
  });
}
