import type { Rule } from "../types.js";
import { findLine } from "./util.js";

/**
 * JetBrains IDEs (IntelliJ, PyCharm, WebStorm) can run configured tasks when
 * a project opens ("Startup Tasks"), stored in .idea/workspace.xml.
 */
export const jetbrainsRule: Rule = {
  id: "jetbrains-startup-task",
  title: "JetBrains startup tasks",
  description: "Finds .idea project files that run a configuration when the project opens.",
  check(ctx) {
    return ctx.files.flatMap((file) => {
      if (!/(^|\/)\.idea\/[^/]+\.xml$/.test(file.path) || !file.content) return [];
      const hit = findLine(file.content, /ProjectStartup(Shared)?Configuration|ProjectStartupLocalConfiguration/);
      if (!hit) return [];
      return [{
        ruleId: "jetbrains-startup-task",
        severity: "dangerous" as const,
        title: "JetBrains project runs a task when it opens",
        explanation: `${file.path} configures a "startup task", so IntelliJ / PyCharm / WebStorm runs a configuration as soon as you open the project.`,
        recommendation: "Delete the .idea folder before opening the project in a JetBrains IDE.",
        file: file.path,
        ...hit,
      }];
    });
  },
};
