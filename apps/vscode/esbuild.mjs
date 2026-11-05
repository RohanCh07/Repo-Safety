import { build } from "esbuild";

// Bundle the extension and @repo-safety/core into one CommonJS file for the VS Code extension host.
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  minify: process.argv.includes("--minify"),
});
