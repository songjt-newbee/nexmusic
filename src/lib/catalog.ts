import {
  catalogKey,
  isUnknownTag,
  songToCatalog,
  updateDisplayFields,
  type CatalogFile,
  type CatalogFilters,
  type CatalogSong,
} from "@/types/catalog";
import type { MusicProvider, Playlist, Song } from "@/types/music";

const PURE_RE =
  /纯音乐|instrumental|\bpiano\b|钢琴曲|钢琴版|\bbgm\b|伴奏|轻音乐|healing\s*piano|古琴|古筝独奏/i;
const CLASSICAL_RE = /交响|协奏曲|奏鸣曲|夜曲|prelude|sonata|concerto|交响曲|\bclassical\b/i;

export function findLikedPlaylist(playlists: Playlist[]): Playlist | undefined {
  return (
    playlists.find((p) => p.id === "liked" || p.id === "qq-liked") ||
    playlists.find((p) => /我喜欢的音乐|QQ 音乐·我的喜欢|^我喜欢/.test(p.name)) ||
    playlists.find((p) => /喜欢|like/i.test(p.name))
  );
}

export function isLikedPlaylist(pl: Playlist | null | undefined): boolean {
  if (!pl) return false;
  return pl.id === "liked" || pl.id === "qq-liked" || /我喜欢的音乐|QQ 音乐·我的喜欢|^我喜欢/.test(pl.name);
}

export function mergeCloudIntoCache(
  cache: CatalogFile,
  provider: MusicProvider,
  cloudSongs: Song[],
  options?: { markMissingUnliked?: boolean; touchSyncedAt?: boolean },
): CatalogFile {
  const markMissingUnliked = options?.markMissingUnliked ?? true;
  const touchSyncedAt = options?.touchSyncedAt ?? true;
  const byKey = new Map(cache.songs.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const merged: CatalogSong[] = [];

  for (const cloud of cloudSongs) {
    const key = catalogKey(provider, cloud.id);
    const existing = byKey.get(key);
    if (existing) {
      merged.push(updateDisplayFields(existing, cloud, provider));
    } else {
      merged.push(songToCatalog(cloud, provider));
    }
    seen.add(key);
  }

  for (const old of cache.songs) {
    if (seen.has(old.key)) continue;
    if (markMissingUnliked && old.sources.includes(provider)) {
      merged.push({ ...old, inLiked: false });
    } else {
      merged.push(old);
    }
  }

  return {
    version: 1,
    syncedAt: touchSyncedAt
      ? { ...cache.syncedAt, [provider]: new Date().toISOString() }
      : cache.syncedAt,
    songs: merged,
  };
}

export function guessLanguage(name: string, artist: string): string {
  const t = `${name}${artist}`;
  if (/[\u3040-\u30ff]/.test(t)) return "日语";
  if (/[\uac00-\ud7af]/.test(t)) return "韩语";
  const letters = t.replace(/[^a-zA-Z]/g, "").length;
  const han = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (letters >= 4 && letters > han * 2) return "英语";
  if (han >= 2) return "华语";
  return "未知";
}

export function guessCountryFromLanguage(language: string): string {
  if (language === "日语") return "日本";
  if (language === "韩语") return "韩国";
  if (language === "华语") return "中国";
  return "未知";
}

export function guessMusicType(name: string, album: string): string {
  const t = `${name} ${album}`;
  if (CLASSICAL_RE.test(t)) return "古典";
  if (PURE_RE.test(t)) return "纯音乐";
  return "未知";
}

/** 只填空字段；已有 DeepSeek/手工标签的歌不覆盖。 */
export function applyGuess(songs: CatalogSong[]): { songs: CatalogSong[]; filled: number } {
  let filled = 0;
  const next = songs.map((song) => {
    if (song.tagSource === "manual" || song.tagSource === "deepseek") return song;
    let changed = false;
    const patch: CatalogSong = { ...song };
    if (isUnknownTag(patch.language)) {
      const lang = guessLanguage(patch.name, patch.artist);
      if (!isUnknownTag(lang)) {
        patch.language = lang;
        changed = true;
      }
    }
    if (isUnknownTag(patch.musicType)) {
      const typ = guessMusicType(patch.name, patch.album);
      if (!isUnknownTag(typ)) {
        patch.musicType = typ;
        changed = true;
      }
    }
    if (isUnknownTag(patch.artistCountry) && !isUnknownTag(patch.language)) {
      const country = guessCountryFromLanguage(patch.language);
      if (!isUnknownTag(country)) {
        patch.artistCountry = country;
        changed = true;
      }
    }
    if (!changed) return song;
    filled += 1;
    patch.tagSource = "guess";
    return patch;
  });
  return { songs: next, filled };
}

export function filterCatalog(songs: CatalogSong[], filters: CatalogFilters): CatalogSong[] {
  return songs.filter((song) => {
    if (filters.hideUnliked && !song.inLiked) return false;
    if (filters.language && filters.language !== "全部" && song.language !== filters.language) return false;
    if (filters.artistCountry && filters.artistCountry !== "全部" && song.artistCountry !== filters.artistCountry) {
      return false;
    }
    if (filters.musicType && filters.musicType !== "全部" && song.musicType !== filters.musicType) return false;
    if (filters.styles.length > 0) {
      const hasAll = filters.styles.every((st) => song.styles.includes(st));
      if (!hasAll) return false;
    }
    return true;
  });
}

export function likedSongsForProvider(cache: CatalogFile, provider: MusicProvider): CatalogSong[] {
  return cache.songs.filter((s) => s.sources.includes(provider) && s.inLiked);
}

export function formatSyncedAt(iso?: string): string {
  if (!iso) return "尚未同步";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseImportedCatalog(raw: unknown): CatalogFile {
  if (!raw || typeof raw !== "object") throw new Error("文件不是有效 JSON 对象");
  const obj = raw as Record<string, unknown>;
  const songs = obj.songs;
  if (!Array.isArray(songs)) throw new Error("缺少 songs 数组");
  const syncedAt =
    obj.syncedAt && typeof obj.syncedAt === "object" && !Array.isArray(obj.syncedAt)
      ? (obj.syncedAt as CatalogFile["syncedAt"])
      : {};
  return {
    version: 1,
    syncedAt,
    songs: songs as CatalogSong[],
  };
}
