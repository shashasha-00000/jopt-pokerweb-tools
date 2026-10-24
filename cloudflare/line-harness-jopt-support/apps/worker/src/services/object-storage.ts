import { AwsClient } from 'aws4fetch';
import { XMLParser } from 'fast-xml-parser';

/** The object operations used by Harness; native R2 bindings also satisfy this. */
export interface ObjectStorage {
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    etag: string;
    httpMetadata?: { contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  } | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface StorageBindings {
  IMAGES?: ObjectStorage;
  APPWRITE_ENDPOINT?: string;
  APPWRITE_PROJECT_ID?: string;
  APPWRITE_BUCKET_ID?: string;
  APPWRITE_API_KEY?: string;
}

export function resolveObjectStorage(env: StorageBindings): ObjectStorage {
  if (env.APPWRITE_ENDPOINT) return new AppwriteObjectStorage(env);
  if (env.IMAGES) return env.IMAGES;
  throw new Error('Object storage is not configured');
}

/** Private Appwrite bucket accessed only by the Worker, via signed S3 requests. */
export class AppwriteObjectStorage implements ObjectStorage {
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(env: StorageBindings) {
    if (!env.APPWRITE_ENDPOINT || !env.APPWRITE_PROJECT_ID || !env.APPWRITE_BUCKET_ID || !env.APPWRITE_API_KEY) {
      throw new Error('Appwrite storage configuration is incomplete');
    }
    const endpoint = new URL(env.APPWRITE_ENDPOINT);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Appwrite endpoint must be an HTTPS API endpoint');
    }
    this.base = `${endpoint.href.replace(/\/$/, '')}/s3/${encodeURIComponent(env.APPWRITE_BUCKET_ID)}`;
    this.client = new AwsClient({
      accessKeyId: env.APPWRITE_PROJECT_ID,
      secretAccessKey: env.APPWRITE_API_KEY,
      service: 's3', region: 'auto', retries: 0,
    });
  }

  private objectUrl(key: string): string {
    // URL normalization would silently collapse dot segments into another key.
    if (!key || key.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error('Invalid object key');
    }
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    // Do not forward credentials to a redirected endpoint or include response
    // bodies in errors (provider diagnostics may contain sensitive material).
    const response = await this.client.fetch(url, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error('Appwrite storage redirects are not allowed');
    }
    return response;
  }

  private check(response: Response, operation: string): void {
    if (!response.ok) throw new Error(`Appwrite storage ${operation} failed (HTTP ${response.status})`);
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }): Promise<void> {
    const headers = new Headers();
    headers.set('Content-Type', options?.httpMetadata?.contentType ?? 'application/octet-stream');
    for (const [name, item] of Object.entries(options?.customMetadata ?? {})) {
      headers.set(`x-amz-meta-${name.toLowerCase()}`, /[^\x20-\x7e]/.test(item) ? encodeURIComponent(item) : item);
    }
    // All current callers supply buffered values. Sign the exact bytes sent.
    const body = ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer
      : value;
    const response = await this.request(this.objectUrl(key), { method: 'PUT', body, headers });
    this.check(response, 'upload');
    await response.body?.cancel();
  }

  async get(key: string) {
    const response = await this.request(this.objectUrl(key));
    if (response.status === 404) { await response.body?.cancel(); return null; }
    this.check(response, 'download');
    if (!response.body) throw new Error('Appwrite storage returned an empty response body');
    return {
      body: response.body,
      etag: response.headers.get('ETag') ?? '',
      httpMetadata: { contentType: response.headers.get('Content-Type') ?? 'application/octet-stream' },
      arrayBuffer: () => response.arrayBuffer(),
      text: () => response.text(),
    };
  }

  async delete(key: string): Promise<void> {
    const response = await this.request(this.objectUrl(key), { method: 'DELETE' });
    if (response.status !== 404) this.check(response, 'delete');
    await response.body?.cancel();
  }

  async list(options: { prefix?: string; cursor?: string } = {}) {
    const url = new URL(this.base);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('max-keys', '1000');
    if (options.prefix) url.searchParams.set('prefix', options.prefix);
    if (options.cursor) url.searchParams.set('continuation-token', options.cursor);
    const response = await this.request(url.href);
    this.check(response, 'list');
    const xml = await response.text();
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unexpected storage XML declaration');
    const result = new XMLParser({ parseTagValue: false, processEntities: true }).parse(xml).ListBucketResult;
    if (!result) throw new Error('Invalid Appwrite storage listing');
    const contents = result.Contents ? (Array.isArray(result.Contents) ? result.Contents : [result.Contents]) : [];
    const truncated = result.IsTruncated === 'true';
    const cursor: string | undefined = result.NextContinuationToken || undefined;
    if (truncated && (!cursor || cursor === options.cursor)) throw new Error('Storage listing did not advance');
    return {
      objects: contents.map((entry: { Key: string }) => ({ key: entry.Key })),
      truncated, cursor,
    };
  }
}
