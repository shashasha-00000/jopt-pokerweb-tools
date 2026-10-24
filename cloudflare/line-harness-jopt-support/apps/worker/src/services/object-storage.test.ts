import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppwriteObjectStorage, resolveObjectStorage } from './object-storage.js';

const config = {
  APPWRITE_ENDPOINT: 'https://fra.cloud.appwrite.io/v1',
  APPWRITE_PROJECT_ID: 'project-test',
  APPWRITE_BUCKET_ID: 'private-bucket',
  APPWRITE_API_KEY: 'secret-test-key',
};

afterEach(() => vi.unstubAllGlobals());

describe('private Appwrite object storage', () => {
  it('signs private uploads and preserves bytes, nested paths, type and metadata', async () => {
    const outgoing = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://fra.cloud.appwrite.io/v1/s3/private-bucket/rich-menus/a%20b.png');
      expect(request.method).toBe('PUT');
      expect(request.headers.get('Authorization')).toContain('AWS4-HMAC-SHA256 Credential=project-test/');
      expect(request.url).not.toContain(config.APPWRITE_API_KEY);
      expect(request.headers.get('Content-Type')).toBe('image/png');
      expect(request.headers.get('x-amz-meta-originalfilename')).toBe('menu.png');
      expect(Array.from(new Uint8Array(await request.arrayBuffer()))).toEqual([2, 3]);
      expect(request.redirect).toBe('manual');
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', outgoing);
    await new AppwriteObjectStorage(config).put('rich-menus/a b.png', new Uint8Array([1, 2, 3, 4]).subarray(1, 3), {
      httpMetadata: { contentType: 'image/png' }, customMetadata: { originalFilename: 'menu.png' },
    });
    expect(outgoing).toHaveBeenCalledOnce();
  });

  it('streams downloads and preserves the MIME type and etag', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('playlist', {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl', ETag: '"abcd"' },
    })));
    const object = await new AppwriteObjectStorage(config).get('webinars/test/master.m3u8');
    expect(object?.httpMetadata.contentType).toBe('application/vnd.apple.mpegurl');
    expect(object?.etag).toBe('"abcd"');
    expect(await object?.text()).toBe('playlist');
  });

  it('returns null for missing keys but fails on quota, auth and provider errors', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await new AppwriteObjectStorage(config).get('missing.png')).toBeNull();
    for (const status of [403, 429, 500]) {
      fetcher.mockResolvedValueOnce(new Response('private provider diagnostics', { status }));
      await expect(new AppwriteObjectStorage(config).get('file.png')).rejects.toThrow(`HTTP ${status}`);
    }
  });

  it('rejects a failed upload so archive callers cannot delete unarchived D1 rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    await expect(new AppwriteObjectStorage(config).put('archive/log.ndjson', 'private log')).rejects.toThrow('HTTP 403');
  });

  it('rejects redirects without forwarding the storage credential', async () => {
    const outgoing = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://other.example.com/' } }));
    vi.stubGlobal('fetch', outgoing);
    await expect(new AppwriteObjectStorage(config).get('private.png')).rejects.toThrow('redirects are not allowed');
    expect(outgoing).toHaveBeenCalledOnce();
  });

  it('lists XML keys without losing leading zeros or escaped characters, and passes the cursor', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get('prefix')).toBe('webinars/');
      expect(url.searchParams.get('continuation-token')).toBe('page+1');
      return new Response('<ListBucketResult><Contents><Key>00001</Key></Contents><Contents><Key>webinars/a&amp;b.ts</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>page+2</NextContinuationToken></ListBucketResult>');
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await new AppwriteObjectStorage(config).list({ prefix: 'webinars/', cursor: 'page+1' })).toEqual({
      objects: [{ key: '00001' }, { key: 'webinars/a&b.ts' }], truncated: true, cursor: 'page+2',
    });
  });

  it('handles empty and single-object final pages and rejects a stalled cursor', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'));
    expect((await new AppwriteObjectStorage(config).list()).objects).toEqual([]);
    fetcher.mockResolvedValueOnce(new Response('<ListBucketResult><Contents><Key>last.ts</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>'));
    expect((await new AppwriteObjectStorage(config).list()).objects).toEqual([{ key: 'last.ts' }]);
    fetcher.mockResolvedValueOnce(new Response('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same</NextContinuationToken></ListBucketResult>'));
    await expect(new AppwriteObjectStorage(config).list({ cursor: 'same' })).rejects.toThrow('did not advance');
  });

  it('does not follow key traversal or insecure endpoints, and leaves native R2 supported', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(new AppwriteObjectStorage(config).get('archive/../secret')).rejects.toThrow('Invalid object key');
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => new AppwriteObjectStorage({ ...config, APPWRITE_ENDPOINT: 'http://example.com/v1' })).toThrow('HTTPS');
    expect(() => new AppwriteObjectStorage({ ...config, APPWRITE_API_KEY: '' })).toThrow('incomplete');
    const native = {} as R2Bucket;
    expect(resolveObjectStorage({ IMAGES: native })).toBe(native);
  });
});
