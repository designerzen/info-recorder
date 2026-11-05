import type { LocationFix } from "../transcript/locatedTranscript";
import type { TranscriptParagraph } from "../transcript/timedTranscript";

const RECORDINGS_DIRECTORY = "recordings";
const TRANSCRIPT_FILE = "transcript.json";
const MEDIA_FILE = "source-media";
const PCM_FILE_PATTERN = /^pcm-\d+\.raw$/;

export type SavedSession = {
  version: 1;
  name: string;
  kind: "recording" | "upload";
  startedAt: number;
  durationMs: number;
  sampleRate: number;
  engine: string;
  paragraphs: TranscriptParagraph[];
  locationTrack: LocationFix[];
  media?: { fileName: string; kind: "audio" | "video"; type: string };
  /** Reopened automatically after a reload until the user starts something new. */
  closed: boolean;
};

export type SavedSessionSummary = Pick<SavedSession, "name" | "kind" | "startedAt" | "durationMs" | "closed"> & {
  excerpt: string;
  title: string;
};

type Directory = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

async function getRecordings() {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(RECORDINGS_DIRECTORY, { create: true }) as Directory;
}

async function getSessionDirectory(name: string, create = false) {
  const recordings = await getRecordings();
  return await recordings.getDirectoryHandle(name, { create }) as Directory;
}

async function writeFile(directory: FileSystemDirectoryHandle, fileName: string, data: Blob | string) {
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  await writable.write(data);
  await writable.close();
}

export async function saveSession(session: SavedSession) {
  const directory = await getSessionDirectory(session.name, true);
  await writeFile(directory, TRANSCRIPT_FILE, JSON.stringify(session));
}

export async function appendSessionAudio(name: string, sequence: number, pcm: Blob) {
  const directory = await getSessionDirectory(name, true);
  await writeFile(directory, `pcm-${String(sequence).padStart(6, "0")}.raw`, pcm);
}

export async function saveSessionMedia(name: string, file: Blob) {
  const directory = await getSessionDirectory(name, true);
  await writeFile(directory, MEDIA_FILE, file);
}

async function readSession(directory: FileSystemDirectoryHandle) {
  const file = await (await directory.getFileHandle(TRANSCRIPT_FILE)).getFile();
  return JSON.parse(await file.text()) as SavedSession;
}

/** Most recent first. Audio-only folders from older versions have no transcript to reopen. */
export async function listSessions(): Promise<SavedSessionSummary[]> {
  const recordings = await getRecordings();
  const summaries: SavedSessionSummary[] = [];
  for await (const [, handle] of recordings.entries()) {
    if (handle.kind !== "directory") continue;
    try {
      const session = await readSession(handle as FileSystemDirectoryHandle);
      const text = session.paragraphs.map((paragraph) => paragraph.text).join(" ");
      summaries.push({
        name: session.name,
        kind: session.kind,
        startedAt: session.startedAt,
        durationMs: session.durationMs,
        closed: session.closed,
        title: session.media?.fileName ?? new Date(session.startedAt).toLocaleString(),
        excerpt: text.slice(0, 120)
      });
    }
    catch {
      continue;
    }
  }
  return summaries.sort((left, right) => right.startedAt - left.startedAt);
}

export async function loadSession(name: string) {
  const directory = await getSessionDirectory(name);
  const session = await readSession(directory);
  const pcmNames: string[] = [];
  for await (const [fileName] of directory.entries()) {
    if (PCM_FILE_PATTERN.test(fileName)) pcmNames.push(fileName);
  }
  pcmNames.sort();
  const pcmParts = await Promise.all(pcmNames.map(async (fileName) => (await directory.getFileHandle(fileName)).getFile()));
  const media = session.media ? await (await directory.getFileHandle(MEDIA_FILE)).getFile() : null;
  return { session, pcmParts, media };
}

export async function deleteSession(name: string) {
  const recordings = await getRecordings();
  await recordings.removeEntry(name, { recursive: true });
}
