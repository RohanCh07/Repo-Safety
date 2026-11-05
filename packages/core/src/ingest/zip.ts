import { readFile, stat } from "node:fs/promises";
import yauzl from "yauzl";
import type { ScannedFile } from "../types.js";
import { toScannedFile } from "./folder.js";
import { IngestError, type IngestLimits } from "./limits.js";
import { safeRelativePath, stripCommonRoot } from "./paths.js";

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Read a ZIP from disk. See readZipBuffer for the protections applied. */
export async function readZipFile(file: string, limits: IngestLimits): Promise<ScannedFile[]> {
  const st = await stat(file).catch(() => undefined);
  if (!st || !st.isFile()) throw new IngestError("not-found", `Not a file: ${file}`);
  if (st.size > limits.maxArchiveBytes) {
    throw new IngestError("too-large", `Archive is larger than ${limits.maxArchiveBytes} bytes.`);
  }
  return readZipBuffer(await readFile(file), limits);
}

/**
 * Read a ZIP archive into memory without extracting it to disk.
 *
 * Protections:
 * - zip-slip: absolute paths and ".." segments are rejected
 * - zip bombs: entry count, total size, per-entry compression ratio, and
 *   actual decompressed bytes are all capped (headers are not trusted)
 * - symlinks are recorded, never followed or materialized
 * - encrypted entries are rejected
 */
export async function readZipBuffer(buf: Buffer, limits: IngestLimits): Promise<ScannedFile[]> {
  if (buf.length > limits.maxArchiveBytes) {
    throw new IngestError("too-large", `Archive is larger than ${limits.maxArchiveBytes} bytes.`);
  }

  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.fromBufferPromise(buf, { lazyEntries: true, validateEntrySizes: true, strictFileNames: false });
  } catch (err) {
    throw new IngestError("invalid-archive", `Not a valid ZIP file (${(err as Error).message}).`);
  }
  if (zip.entryCount > limits.maxEntries) {
    zip.close();
    throw new IngestError("too-many-entries", `Archive has more than ${limits.maxEntries} entries.`);
  }

  const files: ScannedFile[] = [];
  let totalBytes = 0;

  try {
    for await (const entry of zip.eachEntry()) {
      const p = safeRelativePath(entry.fileName, limits.maxDepth);
      if (p === "" || entry.fileName.endsWith("/")) continue; // directory

      if (entry.isEncrypted()) {
        throw new IngestError("encrypted", `Archive contains an encrypted file (${p}). Encrypted archives can't be checked.`);
      }

      const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
      const isSymlink = (mode & S_IFMT) === S_IFLNK;

      const claimed = entry.uncompressedSize;
      if (entry.compressedSize > 0 && claimed / entry.compressedSize > limits.maxCompressionRatio && claimed > 1024 * 1024) {
        throw new IngestError("zip-bomb", `Archive entry ${p} expands suspiciously (possible zip bomb).`);
      }

      if (!isSymlink && claimed > limits.maxFileBytes) {
        totalBytes += claimed;
        if (totalBytes > limits.maxTotalBytes) {
          throw new IngestError("too-large", `Archive expands to more than ${limits.maxTotalBytes} bytes.`);
        }
        files.push({ path: p, size: claimed, isBinary: false, isSymlink: false, skipped: "too-large" });
        continue;
      }

      const data = await readEntryCapped(zip, entry, isSymlink ? 4096 : limits.maxFileBytes);
      totalBytes += data.length;
      if (totalBytes > limits.maxTotalBytes) {
        throw new IngestError("too-large", `Archive expands to more than ${limits.maxTotalBytes} bytes.`);
      }

      if (isSymlink) {
        files.push({ path: p, size: 0, isBinary: false, isSymlink: true, linkTarget: data.toString("utf8"), skipped: "symlink" });
      } else {
        files.push(toScannedFile(p, data));
      }
    }
  } catch (err) {
    zip.close();
    if (err instanceof IngestError) throw err;
    const msg = (err as Error).message ?? String(err);
    if (/invalid relative path|absolute path|invalid characters/i.test(msg)) {
      throw new IngestError("unsafe-path", `Rejected unsafe path in archive (${msg}).`);
    }
    throw new IngestError("invalid-archive", `Could not read archive (${msg}).`);
  }

  const root = stripCommonRoot(files.map((f) => f.path));
  if (root) {
    for (const f of files) f.path = f.path.slice(root.length + 1);
  }
  return files;
}

/** Decompress one entry, stopping as soon as more than `cap` bytes come out. */
async function readEntryCapped(zip: yauzl.ZipFile, entry: yauzl.Entry, cap: number): Promise<Buffer> {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    n += chunk.length;
    if (n > cap) {
      stream.destroy();
      throw new IngestError("zip-bomb", `Archive entry ${entry.fileName} is larger than its header claims (possible zip bomb).`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
