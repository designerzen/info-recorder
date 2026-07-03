export type StoredAudioChunk = {
  fileName: string;
  metadataName: string;
  sequence: number;
  startIso: string;
  endIso: string;
  durationMs: number;
  mimeType: string;
  byteLength: number;
};

export type StoredAudioPart = {
  name: string;
  sequence: number;
  startIso: string;
  endIso: string;
  durationMs: number;
  LAT: number | null;
  LONG: number | null;
  chunks: string[];
};

type FileSystemCreateWritableOptions = {
  keepExistingData?: boolean;
};

type FileSystemWritableFileStream = WritableStream & {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
};

type FileSystemFileHandle = {
  createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<File>;
};

type FileSystemDirectoryHandle = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
};

type StorageManagerWithOpfs = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};

export type OpfsSession = {
  directory: FileSystemDirectoryHandle;
  startedAt: number;
  mimeType: string;
  name: string;
  chunks: StoredAudioChunk[];
  parts: StoredAudioPart[];
};

export function canUseOpfsRecording() {
  return (
    "storage" in navigator &&
    typeof (navigator.storage as Partial<StorageManagerWithOpfs>).getDirectory === "function"
  );
}

export function canUseOpfsPlayback() {
  return "AudioWorkletNode" in window;
}

export async function createOpfsSession(mimeType: string) {
  const startedAt = Date.now();
  const root = await (navigator.storage as StorageManagerWithOpfs).getDirectory();
  const recordings = await root.getDirectoryHandle("recordings", { create: true });
  const name = `session-${toFileTimestamp(new Date(startedAt))}`;
  const directory = await recordings.getDirectoryHandle(name, { create: true });
  const session: OpfsSession = {
    directory,
    startedAt,
    mimeType,
    name,
    chunks: [],
    parts: []
  };

  await writeSessionManifest(session);

  return session;
}

export async function writeMediaRecorderChunk(
  session: OpfsSession,
  blob: Blob,
  sequence: number,
  startMs: number,
  endMs: number
) {
  const sequenceLabel = sequence.toString().padStart(6, "0");
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const extension = getExtension(blob.type || session.mimeType);
  const fileName = `${sequenceLabel}-${toFileTimestamp(new Date(startMs))}.${extension}`;
  const metadataName = `${sequenceLabel}-${toFileTimestamp(new Date(startMs))}.json`;
  const stored: StoredAudioChunk = {
    fileName,
    metadataName,
    sequence,
    startIso,
    endIso,
    durationMs: Math.max(0, Math.round(endMs - startMs)),
    mimeType: blob.type || session.mimeType,
    byteLength: blob.size
  };

  await writeBytes(session.directory, fileName, blob);
  await writeJson(session.directory, metadataName, stored);
  session.chunks.push(stored);
  await writeSessionManifest(session);

  return stored;
}

export async function writeSessionPart(session: OpfsSession, part: StoredAudioPart) {
  session.parts.push(part);
  await writeSessionManifest(session);
  return part;
}

export async function readStoredChunkFiles(session: OpfsSession, fileNames?: string[]) {
  const names = fileNames ?? session.chunks.map((chunk) => chunk.fileName);
  return Promise.all(
    names.map(async (fileName) => {
      const handle = await session.directory.getFileHandle(fileName);
      return handle.getFile();
    })
  );
}

async function writeSessionManifest(session: OpfsSession) {
  await writeJson(session.directory, "session.json", {
    name: session.name,
    startedAt: new Date(session.startedAt).toISOString(),
    format: session.mimeType,
    chunks: session.chunks,
    parts: session.parts
  });
}

async function writeJson(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  data: unknown
) {
  await writeBytes(directory, fileName, new TextEncoder().encode(`${JSON.stringify(data, null, 2)}\n`));
}

async function writeBytes(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  data: BufferSource | Blob | string
) {
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  await writable.write(data);
  await writable.close();
}

function toFileTimestamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function getExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
