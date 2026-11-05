import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

// Output: dist/ is a ready-to-load unpacked extension (chrome://extensions → Load unpacked).
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: { background: "src/background.ts", content: "src/content.ts", options: "src/options.ts" },
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir: "dist",
});
await cp("static", "dist", { recursive: true });
