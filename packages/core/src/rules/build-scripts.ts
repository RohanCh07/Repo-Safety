import type { Finding, Rule } from "../types.js";
import { isVendored, lineText } from "./util.js";

/** "download and run" in one line, the classic installer trap. */
const DOWNLOAD_AND_RUN = [
  /\b(curl|wget)\b[^\n|;]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i,
  /\b(curl|wget)\b[^\n|;]*\|\s*(python3?|node|perl|ruby)\b/i,
  /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|New-Object\s+Net\.WebClient)\b.*\|\s*(iex|Invoke-Expression)\b/i,
  /\b(iex|Invoke-Expression)\s*\(?\s*\(?\s*(New-Object\s+Net\.WebClient|iwr|irm|Invoke-WebRequest)/i,
  /\bbase64\s+(-d|--decode)\b.*\|\s*(ba|z)?sh\b/i,
  /\becho\s+['"]?[A-Za-z0-9+/=]{40,}['"]?\s*\|\s*base64\s+(-d|--decode)/i,
  /\bpowershell(\.exe)?\b.*\s-(e|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i,
  /\bmshta\s+https?:|\bcertutil\b.*-urlcache|\bbitsadmin\b.*\/transfer/i,
];

const SCRIPT_FILE = /(^|\/)(Makefile|GNUmakefile|makefile|[^/]+\.(mk|sh|bash|zsh|ps1|psm1|bat|cmd)|Dockerfile|Justfile|Taskfile\.ya?ml|Rakefile)$/;

/**
 * Build scripts, Makefiles and Terraform that download and run code.
 * They don't run by themselves, but take-home READMEs tell you to run them.
 * Terraform `data "external"` is special: it runs on `terraform plan`.
 */
export const buildScriptsRule: Rule = {
  id: "build-script-exec",
  title: "Build scripts and Terraform that run downloaded code",
  description: "Finds download-and-run commands in shell scripts, Makefiles and Dockerfiles, and Terraform that runs programs.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (isVendored(file.path) || !file.content) continue;
      const lines = file.content.split(/\r?\n/);

      if (SCRIPT_FILE.test(file.path)) {
        for (let i = 0; i < lines.length; i++) {
          if (/^\s*#/.test(lines[i]!)) continue;
          if (!DOWNLOAD_AND_RUN.some((re) => re.test(lines[i]!))) continue;
          findings.push({
            ruleId: "build-script-exec",
            severity: "suspicious",
            title: "Script downloads and runs code",
            explanation:
              `This line in ${file.path} downloads or decodes something and runs it straight away, so you can't see what runs. ` +
              "Real projects sometimes do this for installers, but it is also how malware gets in.",
            recommendation: "Don't run this script until you've opened the URL or decoded the data and read what it does.",
            file: file.path,
            line: i + 1,
            snippet: lineText(file.content, i + 1),
          });
        }
      }

      if (/\.tf$/.test(file.path)) {
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i]!;
          if (/^\s*data\s+"external"\s+"/.test(l)) {
            findings.push({
              ruleId: "build-script-exec",
              severity: "dangerous",
              title: "Terraform runs a program during plan",
              explanation:
                `${file.path} uses the "external" data source, which runs a program on your machine during \`terraform plan\`. ` +
                "Most people think plan is read-only, which is why attackers use it.",
              recommendation: "Read the program it runs before any terraform command, or run Terraform only in a sandbox without your cloud credentials.",
              file: file.path,
              line: i + 1,
              snippet: lineText(file.content, i + 1),
            });
          } else if (/^\s*provisioner\s+"local-exec"/.test(l)) {
            findings.push({
              ruleId: "build-script-exec",
              severity: "suspicious",
              title: "Terraform runs a local command on apply",
              explanation: `${file.path} has a "local-exec" provisioner, which runs a shell command on your machine during \`terraform apply\`.`,
              recommendation: "Read the command before applying, and never apply an unknown repo with real cloud credentials.",
              file: file.path,
              line: i + 1,
              snippet: lineText(file.content, i + 1),
            });
          }
        }
      }
    }
    return findings;
  },
};
