type ProgressCallback = (data: { progress: number; loaded: number; total: number }) => void;

type StoredResponseMeta = {
  headers: Array<[string, string]>;
};

type CacheLikeResponse = {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response, progressCallback?: ProgressCallback): Promise<void>;
  delete?(request: string): Promise<boolean>;
};

const CACHE_ROOT = "transformers-opfs-cache";
const META_SUFFIX = ".meta.json";
const BODY_SUFFIX = ".bin";

export function createTransformersOpfsCache(): CacheLikeResponse {
  return new TransformersOpfsCache();
}

class TransformersOpfsCache implements CacheLikeResponse {
  private rootDirectoryPromise: Promise<FileSystemDirectoryHandle> | null = null;

  async match(request: string) {
    const key = await hashCacheKey(request);
    const root = await this.getRootDirectory();

    try {
      const [metaHandle, bodyHandle] = await Promise.all([
        root.getFileHandle(`${key}${META_SUFFIX}`),
        root.getFileHandle(`${key}${BODY_SUFFIX}`)
      ]);
      const [metaFile, bodyFile] = await Promise.all([metaHandle.getFile(), bodyHandle.getFile()]);
      const meta = JSON.parse(await metaFile.text()) as StoredResponseMeta;
      return new Response(bodyFile.stream(), {
        headers: new Headers(meta.headers)
      });
    } catch {
      return undefined;
    }
  }

  async put(request: string, response: Response, progressCallback?: ProgressCallback) {
    const key = await hashCacheKey(request);
    const root = await this.getRootDirectory();
    const [metaHandle, bodyHandle] = await Promise.all([
      root.getFileHandle(`${key}${META_SUFFIX}`, { create: true }),
      root.getFileHandle(`${key}${BODY_SUFFIX}`, { create: true })
    ]);

    const source = response.clone();
    const total = Number(source.headers.get("content-length")) || 0;
    const bodyWriter = await bodyHandle.createWritable();

    try {
      const body = source.body;
      if (!body) {
        const buffer = await source.arrayBuffer();
        await bodyWriter.write(buffer);
        progressCallback?.({
          progress: 100,
          loaded: buffer.byteLength,
          total: total || buffer.byteLength
        });
      } else {
        const reader = body.getReader();
        let loaded = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            await bodyWriter.write(value);
            loaded += value.byteLength;
            progressCallback?.({
              progress: total > 0 ? (loaded / total) * 100 : 0,
              loaded,
              total
            });
          }
        }

        if (loaded > 0) {
          progressCallback?.({
            progress: 100,
            loaded,
            total: total || loaded
          });
        }
      }

      await bodyWriter.close();

      const metaWriter = await metaHandle.createWritable();
      await metaWriter.write(
        JSON.stringify({
          headers: [...source.headers.entries()]
        } satisfies StoredResponseMeta)
      );
      await metaWriter.close();
    } catch (error) {
      await bodyWriter.abort();
      throw error;
    }
  }

  async delete(request: string) {
    const key = await hashCacheKey(request);
    const root = await this.getRootDirectory();
    const results = await Promise.allSettled([
      root.removeEntry(`${key}${META_SUFFIX}`),
      root.removeEntry(`${key}${BODY_SUFFIX}`)
    ]);
    return results.some((result) => result.status === "fulfilled");
  }

  private async getRootDirectory() {
    this.rootDirectoryPromise ??= initializeRootDirectory();
    return this.rootDirectoryPromise;
  }
}

async function initializeRootDirectory() {
  const storage = navigator.storage;
  if (!storage?.getDirectory) {
    throw new Error("Origin private file storage is unavailable for model caching.");
  }

  try {
    await storage.persist?.();
  } catch {
    // Keep going even if the browser declines persistent storage.
  }

  const originRoot = await storage.getDirectory();
  return originRoot.getDirectoryHandle(CACHE_ROOT, { create: true });
}

async function hashCacheKey(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
