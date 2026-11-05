import type { Rule } from "../types.js";
import { devcontainerRule } from "./devcontainer.js";
import { gitHooksRule } from "./git-hooks.js";
import { packageScriptsRule } from "./package-scripts.js";
import { symlinkRule } from "./symlinks.js";
import { vscodeSettingsRule } from "./vscode-settings.js";
import { vscodeTasksRule } from "./vscode-tasks.js";

/** Every built-in rule. Add new rules here. */
export const builtinRules: Rule[] = [vscodeTasksRule, vscodeSettingsRule, devcontainerRule, packageScriptsRule, gitHooksRule, symlinkRule];

export { devcontainerRule, gitHooksRule, packageScriptsRule, symlinkRule, vscodeSettingsRule, vscodeTasksRule };
