import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Where uploaded ZIPs wait for a worker. They are deleted right after scanning. */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  delete(key: string): Promise<void>;
}

export class MemoryBlobs implements BlobStore {
  private items = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.items.set(key, data);
  }
  async get(key: string) {
    return this.items.get(key);
  }
  async delete(key: string) {
    this.items.delete(key);
  }
  get size() {
    return this.items.size;
  }
}

export class S3Blobs implements BlobStore {
  private client: S3Client;
  constructor(private cfg: { endpoint?: string; region: string; bucket: string; accessKeyId?: string; secretAccessKey?: string }) {
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
      ...(cfg.accessKeyId && cfg.secretAccessKey ? { credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } } : {}),
    });
  }
  async put(key: string, data: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: data, ContentType: "application/zip" }));
  }
  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : undefined;
    } catch {
      return undefined;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}
