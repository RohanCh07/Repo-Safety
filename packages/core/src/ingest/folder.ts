import { constants } from "node:fs";
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
const READ_CONCURRENCY = 32;

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
  const pending: { rel: string; abs: string; index: number }[] = [];

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

      pending.push({ rel: childRel, abs: childAbs, index: files.length });
      files.push({ path: childRel, size: 0, isBinary: false, isSymlink: false });
    }
  }

  // Read file contents in parallel; the walk above only collected paths.
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const job = pending[next++]!;
      const st = await lstat(job.abs);
      if (!st.isFile()) continue;
      if (st.size > limits.maxFileBytes) {
        files[job.index] = { path: job.rel, size: st.size, isBinary: false, isSymlink: false, skipped: "too-large" };
        continue;
      }
      // Local folders are the user's own disk, so going over budget doesn't
      // abort: the file is listed but not read. (ZIP uploads still abort.)
      if (totalBytes + st.size > limits.maxTotalBytes) {
        files[job.index] = { path: job.rel, size: st.size, isBinary: false, isSymlink: false, skipped: "too-large" };
        continue;
      }
      totalBytes += st.size;
      files[job.index] = toScannedFile(job.rel, await readCapped(job.abs, Math.min(st.size, limits.maxFileBytes)));
    }
  };
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
  return files;
}

/** Read at most `cap` bytes, even if the file grows while we read it. */
async function readCapped(file: string, cap: number): Promise<Buffer> {
  // O_NOFOLLOW: if the file was swapped for a symlink after the walk, refuse to read it.
  const fh = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
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
