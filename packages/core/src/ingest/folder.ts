import { lstat, open, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import type { ScannedFile } from "../types.js";
import { IngestError, type IngestLimits } from "./limits.js";
import { safeRelativePath } from "./paths.js";
import { decodeText, looksBinary } from "./text.js";

/**
 * Folders that are huge and never hold auto-run config: git's object store
 * and installed dependencies. `.git/hooks` and `.git/config` are still read.
 */
const SKIP_DIRS = /(^|\/)(\.git\/(objects|lfs|logs|refs|modules)|node_modules)$/;

/**
 * Read a folder from disk. Symlinks are recorded but never followed, so a
 * link to ~/.ssh cannot pull files from outside the folder into the scan.
 */
export async function readFolder(root: string, limits: IngestLimits): Promise<ScannedFile[]> {
  const rootStat = await lstat(root).catch(() => undefined);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new IngestError("not-found", `Not a folder: ${root}`);
  }

  const files: ScannedFile[] = [];
  let entries = 0;
  let totalBytes = 0;
  const queue: string[] = [""];

  while (queue.length > 0) {
    const rel = queue.shift()!;
    const abs = path.join(root, rel);
    const dirents = await readdir(abs, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const d of dirents) {
      if (++entries > limits.maxEntries) {
        throw new IngestError("too-many-entries", `Folder has more than ${limits.maxEntries} entries.`);
      }
      const childRel = safeRelativePath(rel ? `${rel}/${d.name}` : d.name, limits.maxDepth);
      const childAbs = path.join(root, childRel);

      if (d.isSymbolicLink()) {
        const target = await readlink(childAbs).catch(() => "");
        files.push({ path: childRel, size: 0, isBinary: false, isSymlink: true, linkTarget: target, skipped: "symlink" });
        continue;
      }
      if (d.isDirectory()) {
        if (!SKIP_DIRS.test(childRel)) queue.push(childRel);
        continue;
      }
      if (!d.isFile()) continue; // sockets, FIFOs, devices: ignore

      const st = await lstat(childAbs);
      if (st.size > limits.maxFileBytes) {
        files.push({ path: childRel, size: st.size, isBinary: false, isSymlink: false, skipped: "too-large" });
        continue;
      }
      totalBytes += st.size;
      if (totalBytes > limits.maxTotalBytes) {
        throw new IngestError("too-large", `Folder is larger than ${limits.maxTotalBytes} bytes.`);
      }
      const buf = await readCapped(childAbs, Math.min(st.size, limits.maxFileBytes));
      files.push(toScannedFile(childRel, buf));
    }
  }
  return files;
}

/** Read at most `cap` bytes, even if the file grows while we read it. */
async function readCapped(file: string, cap: number): Promise<Buffer> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(cap + 1);
    let offset = 0;
    while (offset < buf.length) {
      const { bytesRead } = await fh.read(buf, offset, buf.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buf.subarray(0, Math.min(offset, cap));
  } finally {
    await fh.close();
  }
}

export function toScannedFile(p: string, buf: Buffer): ScannedFile {
  if (looksBinary(buf)) {
    return { path: p, size: buf.length, isBinary: true, isSymlink: false, skipped: "binary" };
  }
  return { path: p, size: buf.length, isBinary: false, isSymlink: false, content: decodeText(buf) };
}
