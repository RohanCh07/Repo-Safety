import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntryInput {
  /** Raw name, written as-is so tests can include unsafe paths. */
  name: string;
  data?: Buffer | string;
  /** Write a symlink entry whose content is the link target. */
  symlink?: boolean;
  /** Lie about the uncompressed size in the headers. */
  claimedSize?: number;
}

/** Minimal ZIP writer for tests. Lets us build hostile archives on purpose. */
export function buildZip(entries: ZipEntryInput[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = typeof e.data === "string" ? Buffer.from(e.data) : (e.data ?? Buffer.alloc(0));
    const isDir = e.name.endsWith("/");
    const deflate = raw.length > 64;
    const body = deflate ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const size = e.claimedSize ?? raw.length;
    const mode = e.symlink ? 0o120777 : isDir ? 0o040755 : 0o100644;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((mode << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + body.length;
  }

  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
