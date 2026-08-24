export interface Song {
  provider: string;
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
  language: number;
  hash?: string;
  album_id?: string;
  album_audio_id?: string;
  hq_hash?: string;
  sq_hash?: string;
  res_hash?: string;
  qq_song_id?: number;
  addedAt?: number;
  playCount?: number;
}

export interface Artist {
  id?: string;
  mid?: string;
  name: string;
  pic_url?: string;
  music_size?: number;
}

export interface TrackPage {
  songs: Song[];
  total: number;
  hasMore: boolean;
}

export interface Playlist {
  provider: string;
  id: string;
  name: string;
  cover: string;
  track_count: number;
  creator: string;
  subscribed: boolean;
}

export interface SongUrlResult {
  url: string | null;
  playable: boolean;
  trial: boolean;
  level: string;
  quality: string;
  br: number;
  reason?: string;
  message?: string;
  fee?: number;
}

export interface LoginInfo {
  provider: string;
  logged_in: boolean;
  user_id: string;
  nickname: string;
  avatar: string;
  vip_type: number;
  vip_level: string;
  is_vip: boolean;
  is_svip: boolean;
}

export interface Lyrics {
  lyric: string;
  translation?: string;
  roma?: string;
  yrc?: string;
}

export interface LyricWord {
  text: string;
  t: number;
  d: number;
  c0: number;
  c1: number;
}

export interface KaraokeLine {
  time: number;
  duration: number;
  text: string;
  translation?: string;
  words?: LyricWord[];
  charCount: number;
  hasKaraoke: boolean;
}

export type PlayMode = "list" | "shuffle" | "one";
export type LikedSortKey = "artist" | "name" | "addedAt" | "playCount";

export const PLAY_MODE_ORDER: PlayMode[] = ["list", "shuffle", "one"];
export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  list: "列表循环",
  shuffle: "随机播放",
  one: "单曲循环",
};
export type PlaybackQuality = "hires" | "lossless" | "exhigh" | "standard";
export type MusicProvider = "netease" | "kugou" | "qqmusic";

export const PROVIDERS: { id: MusicProvider; name: string }[] = [
  { id: "qqmusic", name: "QQ 音乐" },
  { id: "netease", name: "网易云" },
  { id: "kugou", name: "酷狗" },
];

/** 顶栏展示的平台（网易/酷狗登录逻辑保留，仅 UI 隐藏） */
export const UI_PROVIDERS: { id: MusicProvider; name: string }[] = [{ id: "qqmusic", name: "QQ 音乐" }];
