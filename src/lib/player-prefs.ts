import type { PlayMode, Song } from "@/types/music";

const VOLUME_KEY = "nexmusic-volume";
const SESSION_KEY = "nexmusic-playback-session";
const LOCAL_LIBRARY_KEY = "nexmusic-local-library";

export interface LocalEntry {
  path: string;
  name: string;
  artist: string;
}

export interface PlaybackSession {
  playMode: PlayMode;
  currentSong: Song | null;
  playQueue: Song[];
  currentIndex: number;
}

export function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const n = raw == null ? 0.8 : Number(raw);
    if (!Number.isFinite(n)) return 0.8;
    return Math.min(1, Math.max(0, n));
  } catch {
    return 0.8;
  }
}

export function saveVolume(volume: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    /* quota */
  }
}

export function loadSession(): PlaybackSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaybackSession;
    if (!parsed || !Array.isArray(parsed.playQueue)) return null;
    const playMode = parsed.playMode === "shuffle" || parsed.playMode === "one" ? parsed.playMode : "list";
    return {
      playMode,
      currentSong: parsed.currentSong ?? null,
      playQueue: parsed.playQueue,
      currentIndex: Number.isFinite(parsed.currentIndex) ? parsed.currentIndex : 0,
    };
  } catch {
    return null;
  }
}

export function saveSession(session: PlaybackSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* quota */
  }
}

export function loadLocalLibrary(): LocalEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.path === "string" && item.path);
  } catch {
    return [];
  }
}

export function saveLocalLibrary(entries: LocalEntry[]) {
  try {
    localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(entries));
  } catch {
    /* quota */
  }
}

export function parseLocalFileName(filePath: string): { name: string; artist: string } {
  const base = filePath.split(/[/\\]/).pop() || filePath;
  const stem = base.replace(/\.[^.]+$/, "");
  const parts = stem.split(" - ");
  if (parts.length >= 2 && parts[0].trim() && parts.slice(1).join(" - ").trim()) {
    return { artist: parts[0].trim(), name: parts.slice(1).join(" - ").trim() };
  }
  return { name: stem || "未命名", artist: "本地音乐" };
}

export function localEntryToSong(entry: LocalEntry, playCount = 0): Song {
  return {
    provider: "local",
    id: entry.path,
    name: entry.name,
    artist: entry.artist,
    artists: [{ name: entry.artist }],
    album: "",
    cover: "",
    duration: 0,
    fee: 0,
    playable: true,
    language: 0,
    playCount,
  };
}
