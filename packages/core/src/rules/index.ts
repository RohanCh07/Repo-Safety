import type { Rule } from "../types.js";
import { buildScriptsRule } from "./build-scripts.js";
import { dependenciesRule } from "./dependencies.js";
import { devcontainerRule } from "./devcontainer.js";
import { gitHooksRule } from "./git-hooks.js";
import { jetbrainsRule } from "./jetbrains.js";
import { obfuscationRule } from "./obfuscation.js";
import { packageScriptsRule } from "./package-scripts.js";
import { pythonInstallRule } from "./python-install.js";
import { symlinkRule } from "./symlinks.js";
import { vscodeSettingsRule } from "./vscode-settings.js";
import { vscodeTasksRule } from "./vscode-tasks.js";

/** Every built-in rule. Add new rules here. */
export const builtinRules: Rule[] = [
  vscodeTasksRule,
  vscodeSettingsRule,
  devcontainerRule,
  jetbrainsRule,
  packageScriptsRule,
  pythonInstallRule,
  gitHooksRule,
  buildScriptsRule,
  obfuscationRule,
  dependenciesRule,
  symlinkRule,
];

export {
  buildScriptsRule,
  dependenciesRule,
  devcontainerRule,
  gitHooksRule,
  jetbrainsRule,
  obfuscationRule,
  packageScriptsRule,
  pythonInstallRule,
  symlinkRule,
  vscodeSettingsRule,
  vscodeTasksRule,
};
