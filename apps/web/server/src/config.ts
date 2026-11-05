export interface Config {
  port: number;
  host: string;
  databaseUrl?: string;
  redisUrl?: string;
  s3?: { endpoint?: string; region: string; bucket: string; accessKeyId?: string; secretAccessKey?: string };
  githubToken?: string;
  /** Run scans inside the API process (local dev without Redis). */
  inlineWorker: boolean;
  maxUploadBytes: number;
  maxDownloadBytes: number;
  reportRetentionDays: number;
  rateLimitPerMinute: number;
  publicBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
  return {
    port: num(env.PORT, 8080),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    s3: env.S3_BUCKET
      ? {
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION ?? "us-east-1",
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
    githubToken: env.GITHUB_TOKEN,
    inlineWorker: env.REPO_SAFETY_INLINE_WORKER === "1" || !env.REDIS_URL,
    maxUploadBytes: num(env.MAX_UPLOAD_MB, 50) * 1024 * 1024,
    maxDownloadBytes: num(env.MAX_DOWNLOAD_MB, 100) * 1024 * 1024,
    reportRetentionDays: num(env.REPORT_RETENTION_DAYS, 30),
    rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 20),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "http://localhost:8080",
  };
}
