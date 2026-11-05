import { findNodeAtLocation, parseTree, type Node, type ParseError } from "jsonc-parser";
import type { ScannedFile } from "../types.js";

/** Parsed JSON/JSONC file with helpers to map values back to line numbers. */
export interface JsonDoc {
  file: ScannedFile;
  root: Node;
  value: unknown;
}

/** Parse JSON with comments and trailing commas, like VS Code does. */
export function parseJsonc(file: ScannedFile): JsonDoc | undefined {
  if (file.content === undefined) return undefined;
  const errors: ParseError[] = [];
  const root = parseTree(file.content, errors, { allowTrailingComma: true, disallowComments: false });
  if (!root) return undefined;
  return { file, root, value: nodeValue(root) };
}

function nodeValue(node: Node): unknown {
  switch (node.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const prop of node.children ?? []) {
        const [k, v] = prop.children ?? [];
        if (k && v) out[String(k.value)] = nodeValue(v);
      }
      return out;
    }
    case "array":
      return (node.children ?? []).map(nodeValue);
    default:
      return node.value;
  }
}

/** 1-based line number of a character offset. */
export function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/** The trimmed text of a 1-based line, shortened for display. */
export function lineText(content: string, line: number, max = 200): string {
  const text = (content.split(/\r?\n/)[line - 1] ?? "").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Line number and snippet for a JSON path like ["tasks", 0, "runOptions"]. */
export function locate(doc: JsonDoc, jsonPath: (string | number)[]): { line?: number; snippet?: string } {
  const node = findNodeAtLocation(doc.root, jsonPath);
  const content = doc.file.content ?? "";
  if (!node) return {};
  // Point at the property key when there is one, it reads better.
  const target = node.parent?.type === "property" ? node.parent : node;
  const line = lineAt(content, target.offset);
  return { line, snippet: lineText(content, line) };
}

/** Find the first line in `content` that matches `re`. */
export function findLine(content: string, re: RegExp): { line: number; snippet: string } | undefined {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) return { line: i + 1, snippet: lineText(content, i + 1) };
  }
  return undefined;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/** Paths inside dependency folders are vendored code, not the repo's own config. */
export function isVendored(p: string): boolean {
  return /(^|\/)(node_modules|bower_components|vendor)\//.test(p);
}

/** Test code and fixtures: not installed or run by a normal setup. */
export const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|testdata|test-data|fixtures?|baselines?|__snapshots__|e2e)\/|\.(spec|test)\.\w+$/i;

/**
 * Command patterns that download, decode or hide code. Matching one of these
 * inside something that runs automatically turns "suspicious" into "dangerous".
 */
const RISKY_COMMAND_PATTERNS: { re: RegExp; why: string; weak?: true }[] = [
  { re: /\b(curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b/i, why: "downloads something from the internet" },
  { re: /\|\s*(ba|z|da)?sh\b|\|\s*(python3?|node|perl|ruby|iex|Invoke-Expression)\b/i, why: "pipes text straight into an interpreter" },
  { re: /\bbase64\b|\batob\s*\(|Buffer\.from\([^)]*['"]base64['"]|FromBase64String|-enc(odedcommand)?\b/i, why: "decodes hidden (base64-encoded) data" },
  { re: /\bnode\s+(-e|--eval|-p|--print)\b|\bpython3?\s+-c\b|\bperl\s+-e\b|\bruby\s+-e\b/i, why: "runs inline code" },
  { re: /\beval\b|new\s+Function\s*\(/, why: "evaluates code built at runtime" },
  { re: /\bpowershell(\.exe)?\b|\bpwsh\b|\bcmd(\.exe)?\s+\/c\b|\bmshta\b|\brundll32\b|\bregsvr32\b|\bcertutil\b/i, why: "starts a Windows shell or system tool", weak: true },
  { re: /\bhttps?:\/\/\d{1,3}(\.\d{1,3}){3}/i, why: "contacts a raw IP address" },
  { re: /\b(pastebin\.com|paste\.ee|hastebin|transfer\.sh|ngrok\.io|ngrok-free\.app|raw\.githubusercontent\.com|gist\.githubusercontent\.com|discord(app)?\.com\/api\/webhooks|api\.telegram\.org)\b/i, why: "contacts a site often used to host payloads" },
  { re: /\bchmod\s+\+?[0-7]*x|\bchmod\s+[0-7]{3,4}\b/, why: "makes a file executable", weak: true },
  { re: /(^|[;&|\s])(\/tmp\/|%TEMP%|\$env:TEMP|\$TMPDIR)/i, why: "writes to or runs from a temp folder", weak: true },
  { re: /\b(nohup|disown|setsid)\b|&\s*$|\bstart\s+\/b\b/i, why: "runs something in the background", weak: true },
];

/** Reasons a command line looks risky, empty when it looks ordinary. */
export function riskyCommandReasons(command: string): string[] {
  const reasons: string[] = [];
  for (const { re, why } of RISKY_COMMAND_PATTERNS) if (re.test(command)) reasons.push(why);
  return reasons;
}

/**
 * Like riskyCommandReasons, but empty unless at least one strong signal is
 * present. Used for things the user starts by hand, to keep noise down.
 */
export function strongRiskReasons(command: string): string[] {
  const strong = RISKY_COMMAND_PATTERNS.some((p) => !p.weak && p.re.test(command));
  return strong ? riskyCommandReasons(command) : [];
}

/** Turn a VS Code task / devcontainer command value into one string. */
export function commandToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(commandToString).join(" ");
  if (isObject(v)) return Object.values(v).map(commandToString).join(" ; ");
  return "";
}

export function quote(s: string, max = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  return `\`${t.length > max ? `${t.slice(0, max)}…` : t}\``;
}
