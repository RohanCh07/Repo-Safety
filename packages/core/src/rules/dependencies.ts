import type { Finding, Rule } from "../types.js";
import { isObject, isVendored, locate, parseJsonc, TEST_PATH } from "./util.js";

/** A small list of very popular packages; names one edit away are likely typosquats. */
const POPULAR_NPM = [
  "react", "react-dom", "express", "lodash", "axios", "chalk", "commander", "debug", "dotenv", "moment", "uuid",
  "webpack", "typescript", "eslint", "prettier", "jest", "mocha", "vite", "next", "vue", "angular", "svelte",
  "mongoose", "mongodb", "mysql", "mysql2", "pg", "redis", "ioredis", "sequelize", "prisma", "knex", "socket.io",
  "body-parser", "cors", "helmet", "jsonwebtoken", "bcrypt", "bcryptjs", "passport", "nodemon", "cross-env",
  "request", "node-fetch", "got", "yargs", "inquirer", "ora", "glob", "rimraf", "mkdirp", "fs-extra", "semver",
  "classnames", "styled-components", "tailwindcss", "postcss", "autoprefixer", "sass", "babel-core", "@babel/core",
  "ethers", "web3", "electron", "puppeteer", "playwright", "cheerio", "jquery", "bootstrap", "three", "d3",
  "preact", "enquirer", "koa", "fastify", "nuxt", "pino", "winston", "sharp", "esbuild", "rollup", "parcel",
  "chai", "sinon", "vitest", "turbo", "lerna", "nx", "pnpm", "yarn", "npm", "ws", "minimist", "qs", "ms",
  "zod", "yup", "formik", "redux", "react-redux", "react-router", "react-router-dom", "rxjs", "graphql", "apollo-server",
];
const POPULAR_PYPI = [
  "requests", "numpy", "pandas", "flask", "django", "fastapi", "pydantic", "boto3", "urllib3", "setuptools",
  "pytest", "scipy", "matplotlib", "pillow", "sqlalchemy", "psycopg2", "pyyaml", "beautifulsoup4", "selenium",
  "tensorflow", "torch", "scikit-learn", "openai", "cryptography", "paramiko", "colorama", "python-dotenv", "uvicorn",
  "web3", "celery", "redis", "jinja2", "click", "aiohttp", "httpx", "attrs", "six", "idna", "certifi",
  "packaging", "wheel", "pip", "rich", "typer", "starlette", "gunicorn", "pymongo", "pytz", "tqdm", "black", "ruff", "mypy",
];

/** Edit distance with adjacent swaps, capped at 2 for speed. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

export function lookalikeOf(name: string, popular: string[]): string | undefined {
  const n = name.toLowerCase();
  if (popular.includes(n) || n.length < 4) return undefined;
  const normalized = n.replace(/[-_.]/g, "");
  for (const p of popular) {
    if (p.length < 4) continue;
    if (normalized === p.replace(/[-_.]/g, "") && n !== p) return p;
    if (distance(n, p) === 1) return p;
  }
  return undefined;
}

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/**
 * Dependencies that skip the registry (Git URLs, tarballs, local files) or
 * whose names are one typo away from a famous package.
 */
export const dependenciesRule: Rule = {
  id: "suspicious-dependency",
  title: "Suspicious dependencies",
  description: "Finds dependencies installed from URLs instead of the registry, and names that look like typos of popular packages.",
  check(ctx) {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (isVendored(file.path) || !file.content || TEST_PATH.test(file.path)) continue;

      if (/(^|\/)package\.json$/.test(file.path)) {
        const doc = parseJsonc(file);
        if (!doc || !isObject(doc.value)) continue;
        for (const field of DEP_FIELDS) {
          const deps = doc.value[field];
          if (!isObject(deps)) continue;
          for (const [name, spec] of Object.entries(deps)) {
            if (typeof spec !== "string") continue;
            const at = locate(doc, [field, name]);
            if (/^(https?:|git(\+\w+)?:|git@|github:|gitlab:|bitbucket:|gist:)/i.test(spec) || /^[\w-]+\/[\w.-]+(#.*)?$/.test(spec)) {
              findings.push({
                ruleId: "suspicious-dependency",
                severity: "suspicious",
                title: "Dependency installed from a URL instead of npm",
                explanation:
                  `"${name}" comes from ${JSON.stringify(spec)} rather than the npm registry, so npm's malware checks never saw it and its contents can change at any time.`,
                recommendation: "Check that URL by hand, or replace it with the official package from npm.",
                file: file.path,
                ...at,
              });
            }
            const twin = lookalikeOf(name, POPULAR_NPM);
            if (twin) {
              findings.push({
                ruleId: "suspicious-dependency",
                severity: "suspicious",
                title: "Package name looks like a typo of a popular package",
                explanation: `"${name}" is one letter away from the popular package "${twin}". Attackers publish look-alike names to trick people into installing malware.`,
                recommendation: `Check on npmjs.com that "${name}" is really what the project needs, and not "${twin}".`,
                file: file.path,
                ...at,
              });
            }
          }
        }
      }

      if (/(^|\/)requirements[^/]*\.txt$/.test(file.path)) {
        file.content.split(/\r?\n/).forEach((raw, i) => {
          const l = raw.trim();
          if (!l || l.startsWith("#")) return;
          if (/^(-e\s+)?(git\+|https?:)|@\s*(https?:|git\+)/i.test(l) || /^--(extra-)?index-url\s/.test(l)) {
            findings.push({
              ruleId: "suspicious-dependency",
              severity: "suspicious",
              title: /index-url/.test(l) ? "Installs Python packages from an unofficial index" : "Python dependency installed from a URL",
              explanation: `${file.path} line ${i + 1} pulls packages from outside PyPI (${l.slice(0, 120)}), so they skip PyPI's checks.`,
              recommendation: "Check that source by hand before running pip install.",
              file: file.path,
              line: i + 1,
              snippet: l.slice(0, 200),
            });
            return;
          }
          const name = l.split(/[\s<>=!~;\[@]/)[0] ?? "";
          const twin = lookalikeOf(name, POPULAR_PYPI);
          if (twin) {
            findings.push({
              ruleId: "suspicious-dependency",
              severity: "suspicious",
              title: "Package name looks like a typo of a popular package",
              explanation: `"${name}" is one letter away from the popular package "${twin}". Look-alike names are a common way to slip malware into installs.`,
              recommendation: `Check on pypi.org that "${name}" is really what the project needs, and not "${twin}".`,
              file: file.path,
              line: i + 1,
              snippet: l.slice(0, 200),
            });
          }
        });
      }
    }
    return findings;
  },
};

