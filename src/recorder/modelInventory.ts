import type { TranscriptionModelId } from "../config/settings";

export type ModelInventoryEntry = {
  modelId: TranscriptionModelId;
  cached: boolean;
  cachedFiles: number;
  totalFiles: number;
  sizeBytes: number;
  cachedBytes: number;
  message?: string;
};

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Ready soon";

  const rounded = Math.max(1, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function estimateSecondsRemaining(remainingBytes: number, bytesPerSecond: number) {
  if (!Number.isFinite(remainingBytes) || remainingBytes <= 0) return 0;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return remainingBytes / bytesPerSecond;
}
