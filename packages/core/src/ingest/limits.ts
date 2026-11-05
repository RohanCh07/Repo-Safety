/** Hard limits that protect the scanner from hostile input. */
export interface IngestLimits {
  /** Maximum number of entries (files, dirs, links) to accept. */
  maxEntries: number;
  /** Maximum total uncompressed bytes across all files. */
  maxTotalBytes: number;
  /** Files bigger than this are listed but their content is not loaded. */
  maxFileBytes: number;
  /** Maximum directory depth. */
  maxDepth: number;
  /** Maximum uncompressed/compressed ratio for one ZIP entry (zip-bomb guard). */
  maxCompressionRatio: number;
  /** Maximum size of a ZIP file on disk / in memory. */
  maxArchiveBytes: number;
}

export const DEFAULT_LIMITS: IngestLimits = {
  maxEntries: 100_000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxCompressionRatio: 200,
  maxArchiveBytes: 100 * 1024 * 1024,
};

export function resolveLimits(partial?: Partial<IngestLimits>): IngestLimits {
  return { ...DEFAULT_LIMITS, ...partial };
}

/** Thrown when input is rejected. The message is safe to show to users. */
export class IngestError extends Error {
  constructor(
    public readonly code:
      | "unsafe-path"
      | "too-many-entries"
      | "too-large"
      | "too-deep"
      | "zip-bomb"
      | "encrypted"
      | "invalid-archive"
      | "not-found",
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}
