import type { Artist, MusicProvider, Song } from "@/types/music";

export type TagSource = "none" | "guess" | "deepseek" | "manual";

export const LANGUAGES = ["未知", "华语", "英语", "日语", "韩语", "其他"] as const;
export const COUNTRIES = ["未知", "中国", "美国", "日本", "韩国", "英国", "其他"] as const;
export const MUSIC_TYPES = ["未知", "歌曲", "纯音乐", "古典"] as const;
export const STYLE_PRESETS = [
  "流行",
  "摇滚",
  "民谣",
  "电子",
  "爵士",
  "轻音乐",
  "古风",
  "说唱",
  "R&B",
  "影视",
  "动漫",
  "古典",
] as const;

export interface CatalogSong {
  key: string;
  sources: MusicProvider[];
  inLiked: boolean;
  id: string;
  mid?: string;
  media_mid?: string;
  name: string;
  artist: string;
  artists: Artist[];
  album: string;
  cover: string;
  duration: number;
  fee: number;
  playable: boolean;
  hash?: string;
  album_id?: string;
  album_audio_id?: string;
  hq_hash?: string;
  sq_hash?: string;
  res_hash?: string;
  qq_song_id?: number;
  language: string;
  artistCountry: string;
  musicType: string;
  styles: string[];
  tagSource: TagSource;
}

export interface CatalogFile {
  version: 1;
  syncedAt: Partial<Record<MusicProvider, string>>;
  songs: CatalogSong[];
}

export interface CatalogFilters {
  language: string;
  artistCountry: string;
  musicType: string;
  styles: string[];
  hideUnliked: boolean;
}

export interface AiSongIn {
  key: string;
  name: string;
  artist: string;
  album: string;
}

export interface AiSongOut {
  key: string;
  language: string;
  artistCountry: string;
  musicType: string;
  styles: string[];
}

export function emptyCatalog(): CatalogFile {
  return { version: 1, syncedAt: {}, songs: [] };
}

export function catalogKey(provider: MusicProvider, id: string): string {
  return `${provider}:${id}`;
}

export function isUnknownTag(value: string | undefined): boolean {
  return !value || value === "未知";
}

export function songNeedsTags(song: CatalogSong): boolean {
  return (
    isUnknownTag(song.language) ||
    isUnknownTag(song.artistCountry) ||
    isUnknownTag(song.musicType) ||
    song.styles.length === 0
  );
}

export function songToCatalog(song: Song, provider: MusicProvider): CatalogSong {
  return {
    key: catalogKey(provider, song.id),
    sources: [provider],
    inLiked: true,
    id: song.id,
    mid: song.mid,
    media_mid: song.media_mid,
    name: song.name,
    artist: song.artist,
    artists: song.artists?.length ? song.artists : [{ name: song.artist }],
    album: song.album,
    cover: song.cover,
    duration: song.duration,
    fee: song.fee,
    playable: song.playable,
    hash: song.hash,
    album_id: song.album_id,
    album_audio_id: song.album_audio_id,
    hq_hash: song.hq_hash,
    sq_hash: song.sq_hash,
    res_hash: song.res_hash,
    qq_song_id: song.qq_song_id,
    language: "未知",
    artistCountry: "未知",
    musicType: "未知",
    styles: [],
    tagSource: "none",
  };
}

export function catalogToSong(song: CatalogSong): Song {
  const provider = song.sources[0] ?? "qqmusic";
  return {
    provider,
    id: song.id,
    mid: song.mid,
    media_mid: song.media_mid,
    name: song.name,
    artist: song.artist,
    artists: song.artists?.length ? song.artists : [{ name: song.artist }],
    album: song.album,
    cover: song.cover,
    duration: song.duration,
    fee: song.fee,
    playable: song.playable,
    language: 0,
    hash: song.hash,
    album_id: song.album_id,
    album_audio_id: song.album_audio_id,
    hq_hash: song.hq_hash,
    sq_hash: song.sq_hash,
    res_hash: song.res_hash,
    qq_song_id: song.qq_song_id,
  };
}

export function updateDisplayFields(existing: CatalogSong, cloud: Song, provider: MusicProvider): CatalogSong {
  const sources = existing.sources.includes(provider) ? existing.sources : [...existing.sources, provider];
  return {
    ...existing,
    sources,
    inLiked: true,
    id: cloud.id,
    mid: cloud.mid || existing.mid,
    media_mid: cloud.media_mid || existing.media_mid,
    name: cloud.name || existing.name,
    artist: cloud.artist || existing.artist,
    artists: cloud.artists?.length ? cloud.artists : existing.artists,
    album: cloud.album || existing.album,
    cover: cloud.cover || existing.cover,
    duration: cloud.duration || existing.duration,
    fee: cloud.fee,
    playable: cloud.playable,
    hash: cloud.hash || existing.hash,
    album_id: cloud.album_id || existing.album_id,
    album_audio_id: cloud.album_audio_id || existing.album_audio_id,
    hq_hash: cloud.hq_hash || existing.hq_hash,
    sq_hash: cloud.sq_hash || existing.sq_hash,
    res_hash: cloud.res_hash || existing.res_hash,
    qq_song_id: cloud.qq_song_id ?? existing.qq_song_id,
  };
}
