const ACTIVE_DOWNLOAD_MAX_PROGRESS = 99;

export type DownloadManifestEntry = {
  url: string;
  size: number;
  cached: boolean;
};

type DownloadState = {
  size: number;
  loaded: number;
  cached: boolean;
  done: boolean;
};

export class ModelDownloadTracker {
  private readonly files = new Map<string, DownloadState>();
  private totalBytes = 0;
  private loadedBytes = 0;

  constructor(entries: DownloadManifestEntry[]) {
    for (const entry of entries) {
      const size = Number.isFinite(entry.size) ? Math.max(0, entry.size) : 0;
      this.files.set(entry.url, {
        size,
        loaded: entry.cached ? size : 0,
        cached: entry.cached,
        done: entry.cached
      });
      this.totalBytes += size;
      this.loadedBytes += entry.cached ? size : 0;
    }
  }

  trackProgress(url: string, loaded: number, total?: number) {
    const state = this.files.get(url);
    if (!state) return this.getProgress();

    if (typeof total === "number" && Number.isFinite(total) && total > state.size) {
      this.totalBytes += total - state.size;
      state.size = total;
      if (state.cached && state.loaded < total) {
        this.loadedBytes += total - state.loaded;
        state.loaded = total;
      }
    }

    const nextLoaded = Math.min(
      state.size || Number.MAX_SAFE_INTEGER,
      Math.max(state.loaded, Math.max(0, loaded))
    );
    this.loadedBytes += nextLoaded - state.loaded;
    state.loaded = nextLoaded;
    return this.getProgress();
  }

  markDone(url: string) {
    const state = this.files.get(url);
    if (!state) return this.getProgress();

    const nextLoaded = Math.max(state.loaded, state.size);
    this.loadedBytes += nextLoaded - state.loaded;
    state.loaded = nextLoaded;
    state.done = true;
    return this.getProgress();
  }

  getProgress() {
    if (this.totalBytes <= 0) {
      return 0;
    }

    const percent = (this.loadedBytes / this.totalBytes) * 100;
    return Math.min(ACTIVE_DOWNLOAD_MAX_PROGRESS, Math.max(0, percent));
  }

  getLoadedBytes() {
    return this.loadedBytes;
  }

  getTotalBytes() {
    return this.totalBytes;
  }
}

export function clampProgress(value: number) {
  return Math.min(100, Math.max(0, value));
}
