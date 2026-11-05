import type { Finding, Rule } from "../types.js";
import { commandToString, isObject, isVendored, locate, parseJsonc, quote, riskyCommandReasons } from "./util.js";

/** Lifecycle hooks, in the order they run. Only initializeCommand runs on your own machine. */
const HOOKS = ["initializeCommand", "onCreateCommand", "updateContentCommand", "postCreateCommand", "postStartCommand", "postAttachCommand"] as const;

/**
 * Dev container configs run commands when VS Code / Codespaces builds the
 * container. `initializeCommand` is special: it runs on the HOST, before the
 * container exists, so it is as dangerous as a folder-open task.
 */
export const devcontainerRule: Rule = {
  id: "devcontainer-command",
  title: "Dev container lifecycle commands",
  description: "Finds commands in devcontainer.json that run when the dev container is created or started.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (isVendored(file.path)) continue;
      if (!/(^|\/)(\.devcontainer\/(.+\/)?devcontainer\.json|\.devcontainer\.json)$/i.test(file.path)) continue;
      const doc = parseJsonc(file);
      if (!doc || !isObject(doc.value)) continue;
      const cfg = doc.value;

      for (const hook of HOOKS) {
        if (cfg[hook] === undefined) continue;
        const command = commandToString(cfg[hook]);
        if (!command.trim()) continue;
        const reasons = riskyCommandReasons(command);
        const onHost = hook === "initializeCommand";
        const where = locate(doc, [hook]);

        if (onHost) {
          findings.push({
            ruleId: "devcontainer-command",
            severity: "dangerous",
            title: "Dev container runs a command on your own computer",
            explanation:
              `"initializeCommand" runs ${quote(command)} directly on your machine (not inside the container) when you choose "Reopen in Container".` +
              (reasons.length ? ` The command ${reasons.join(", ")}.` : ""),
            recommendation: "Remove initializeCommand before opening this project in a dev container.",
            file: file.path,
            ...where,
          });
        } else if (reasons.length) {
          findings.push({
            ruleId: "devcontainer-command",
            severity: "suspicious",
            title: "Dev container runs a risky setup command",
            explanation:
              `"${hook}" runs ${quote(command)} inside the container, and the command ${reasons.join(", ")}. ` +
              "The container limits the damage, but it can still reach the network and any folders mounted into it.",
            recommendation: "Read this command before building the container, and don't mount your home folder or secrets into it.",
            file: file.path,
            ...where,
          });
        }
      }

      const runArgs = Array.isArray(cfg["runArgs"]) ? cfg["runArgs"].map(String) : [];
      if (cfg["privileged"] === true || runArgs.some((a) => /^--privileged\b|^--pid=host\b|^--network=host\b|docker\.sock/.test(a))) {
        findings.push({
          ruleId: "devcontainer-command",
          severity: "suspicious",
          title: "Dev container asks for extra access to your machine",
          explanation: "This container is configured with privileged mode or host access, which lets code inside it reach your real computer.",
          recommendation: "Remove privileged / host options unless you know exactly why the project needs them.",
          file: file.path,
          ...locate(doc, [cfg["privileged"] === true ? "privileged" : "runArgs"]),
        });
      }
      const mounts = commandToString(cfg["mounts"]);
      if (/\$\{localEnv:(HOME|USERPROFILE)\}|source=\/(,|$)|source=~|\.ssh|\.aws|\.kube|\.gnupg/i.test(mounts)) {
        findings.push({
          ruleId: "devcontainer-command",
          severity: "suspicious",
          title: "Dev container mounts your home folder or credentials",
          explanation: `The "mounts" setting shares ${quote(mounts)} from your computer with the container, so code inside it can read those files.`,
          recommendation: "Remove mounts of your home folder, SSH keys or cloud credentials.",
          file: file.path,
          ...locate(doc, ["mounts"]),
        });
      }
    }
    return findings;
  },
};
