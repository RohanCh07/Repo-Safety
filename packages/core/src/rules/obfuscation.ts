import type { Finding, Rule } from "../types.js";
import { isVendored, lineText, TEST_PATH } from "./util.js";

const SOURCE = /\.(c?js|mjs|jsx|ts|tsx|cts|mts|py|rb|php|sh|ps1|vue|svelte)$|(^|\/)[^/.]+\.config\.\w+$/;
/** Generated or minified files that are long and dense by design. */
const GENERATED = /(\.min\.\w+$|(^|\/)(dist|build|out|coverage|\.next|public\/assets|static\/js|vendor|third[_-]?party)\/|\.bundle\.\w+$|-lock\.|\.lock$|\.map$|\.snap$|\.d\.ts$)/i;

/** Base64 that starts with a common image or font header. */
const MEDIA_B64 = /^(iVBORw0KGgo|\/9j\/|R0lGOD|PHN2Zy|PD94bWwg|AAABAA|d09GR|d09GMg|T1RUTw|AAEAAAA|UklGR|SUQz|GkXfo|JVBERi0)/;

const EXEC_SINK = /\beval\s*\(|new\s+Function\s*\(|(?<![.\w])Function\s*\(\s*['"`]|(?<![.\w])exec(Sync)?\s*\(|\bvm\.(runIn\w+|Script)\b|\bexec\s*\(\s*(compile|base64|zlib|marshal|codecs|bytes)|__import__\s*\(\s*['"]base64/;
const DECODE_OR_REMOTE = /\batob\s*\(|base64|fromCharCode|\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){7}|\bunescape\s*\(|zlib\.|marshal\.loads|codecs\.decode|\bfetch\s*\(|\baxios\b|\bhttps?\.get\s*\(|\burlopen\s*\(|\brequests\.get\s*\(/i;
const B64_BLOB = /['"`]([A-Za-z0-9+/]{300,}={0,2})['"`]/;
/** A blob only matters if the file also decodes or evaluates something. */
const DECODER = /\batob\s*\(|b64decode|base64|Buffer\.from\s*\(|fromhex|unhexlify|\beval\s*\(|Function\s*\(|\bexec\s*\(|fromCharCode/;
/** Fingerprints of javascript-obfuscator and similar packers. */
const OBFUSCATOR_MARKS = /_0x[0-9a-f]{4,}|(\\x[0-9a-fA-F]{2}){20,}|String\.fromCharCode\(|\beval\(|\bFunction\(|\batob\(|\['\\x/;
const HEX_BLOB = /(\\x[0-9a-fA-F]{2}){60,}|['"`][0-9a-fA-F]{400,}['"`]/;

/**
 * Hidden code: payloads pushed off-screen with whitespace, huge encoded
 * blobs, and decoded or downloaded data passed to eval/exec.
 */
export const obfuscationRule: Rule = {
  id: "obfuscated-code",
  title: "Hidden or obfuscated code",
  description: "Finds code hidden off-screen, large encoded blobs, and eval/exec on decoded or downloaded data.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!file.content || isVendored(file.path) || GENERATED.test(file.path) || !SOURCE.test(file.path)) continue;
      const lines = file.content.split(/\r?\n/);
      const perFile: Finding[] = [];
      const isTest = TEST_PATH.test(file.path);

      for (let i = 0; i < lines.length && perFile.length < 3; i++) {
        const l = lines[i]!;
        const at = { file: file.path, line: i + 1 };

        // Code after a long run of spaces/tabs: invisible in an editor without scrolling right.
        const hidden = l.length > 160 && /\S[ \t]{150}/.test(l) ? l.match(/^(.*?\S)([ \t]{150,})(\S.{10,})$/) : null;
        if (hidden && looksLikeCode(hidden[3]!)) {
          perFile.push({
            ruleId: "obfuscated-code",
            severity: "dangerous",
            title: "Code is hidden off the right edge of the screen",
            explanation:
              `Line ${i + 1} of ${file.path} has ${hidden[2]!.length} spaces before more code, so the code is invisible unless you scroll far to the right. ` +
              "There is no legitimate reason to format code like this.",
            recommendation: "Do not run this project. Turn on word wrap to see the hidden code.",
            ...at,
            snippet: `…${hidden[3]!.slice(0, 160)}`,
          });
          continue;
        }

        if (EXEC_SINK.test(withoutStrings(l)) && !isTest && !/^\s*(\/\/|#|\*)/.test(l) && DECODE_OR_REMOTE.test(lines.slice(Math.max(0, i - 2), i + 3).join("\n"))) {
          perFile.push({
            ruleId: "obfuscated-code",
            severity: "dangerous",
            title: "Runs code that was decoded or downloaded",
            explanation:
              `${file.path} passes data that is decoded or fetched at runtime to eval/exec. That means the code that actually runs is not in the repo where you can read it.`,
            recommendation: "Do not run this project. This is how remote payloads are usually loaded.",
            ...at,
            snippet: lineText(file.content, i + 1),
          });
          continue;
        }

        if (isTest) continue;
        const b64 = l.match(B64_BLOB);
        const b64Hit = b64 && !MEDIA_B64.test(b64[1]!) && !/data:(image|font|application\/font)/.test(l) && DECODER.test(file.content);
        const hexHit = HEX_BLOB.test(l) && /[a-fA-F]/.test(l.match(HEX_BLOB)![0]) && DECODER.test(file.content);
        if (b64Hit || hexHit) {
          perFile.push({
            ruleId: "obfuscated-code",
            severity: "suspicious",
            title: "Large encoded blob in source code",
            explanation: `Line ${i + 1} of ${file.path} contains a long base64 or hex string. It may be an image or font, but it can also hide a payload.`,
            recommendation: "Decode it (without running it) to see what it is.",
            ...at,
            snippet: lineText(file.content, i + 1, 120),
          });
          continue;
        }

        if (l.length > 2000 && whitespaceRatio(l) < 0.05 && OBFUSCATOR_MARKS.test(l) && !/^\s*(\/\/|#)/.test(l)) {
          perFile.push({
            ruleId: "obfuscated-code",
            severity: "suspicious",
            title: "Very long, dense line of code",
            explanation:
              `Line ${i + 1} of ${file.path} is ${l.length} characters with almost no spaces, which is typical of obfuscated or packed code in a file that should be hand-written.`,
            recommendation: "Format the file and read what this line does before running anything.",
            ...at,
            snippet: lineText(file.content, i + 1, 120),
          });
        }
      }
      findings.push(...perFile);
    }
    return findings;
  },
};

/** The hidden part must look like a statement, not a run of ~~~ or a table border. */
function looksLikeCode(s: string): boolean {
  if (/^\s*(\/\/|#|\*|\/\*|<!--)/.test(s)) return false;
  return /[A-Za-z_$][\w$]*\s*(\(|=[^=]|\.[A-Za-z_$])/.test(s);
}

/** Replace string literal contents so `eval()` mentioned in text doesn't count. */
function withoutStrings(s: string): string {
  return s.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
}

function whitespaceRatio(s: string): number {
  let ws = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) <= 32) ws++;
  return ws / s.length;
}
