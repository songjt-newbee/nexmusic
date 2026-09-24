import { create } from "zustand";
import { addPluginListener, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isLikedPlaylist } from "@/lib/catalog";
import {
  loadLocalLibrary,
  loadSession,
  loadVolume,
  localEntryToSong,
  parseLocalFileName,
  saveLocalLibrary,
  saveSession,
  saveVolume,
  type LocalEntry,
} from "@/lib/player-prefs";
import { preferLibraryMatches } from "@/lib/list-query";
import { maybeFillTranslation } from "@/lib/lyric-translate";
import { hasUsableTags, pickSimilarIndex, tagsFromCatalog } from "@/lib/similar-shuffle";
import {
  LikedSortKey,
  LoginInfo,
  Lyrics,
  MusicProvider,
  Playlist,
  PlayMode,
  PLAY_MODE_LABEL,
  PLAY_MODE_ORDER,
  Song,
  SongUrlResult,
} from "@/types/music";
import {
  bindMediaSessionControls,
  maybeSyncPosition,
  stopMediaSession,
  syncMediaSession,
} from "@/lib/media-session";

export type TabId = "mine" | "search" | "classify" | "settings";

function isKeptPlaylist(pl: Playlist): boolean {
  if (pl.id === "liked") return true;
  if (pl.subscribed) return true;
  return /喜欢|我喜欢|like/i.test(pl.name);
}

export function coverProxyUrl(url: string, proxyPort: number): string {
  if (!url || url.startsWith("data:")) return url;
  if (!proxyPort) return url;
  return `http://127.0.0.1:${proxyPort}/cover?url=${encodeURIComponent(url)}`;
}

let playSeq = 0;
let unlistens: UnlistenFn[] = [];

function invokeErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.message.includes("invoke") || e.name === "TypeError") {
      return "请在 NexMusic 桌面窗口中操作，浏览器无法调用应用接口";
    }
    return e.message;
  }
  if (typeof e === "string" && e.trim()) return e;
  return "操作失败";
}

const PLAY_COUNT_KEY = "nexmusic-play-counts";

export type CacheMode = "off" | "after_play";

const CACHE_MODE_KEY = "nexmusic-cache-mode";
const SIMILAR_SHUFFLE_KEY = "nexmusic-similar-shuffle";
const RECENT_PLAY_LIMIT = 8;

const recentPlayKeys: string[] = [];

function rememberPlay(key: string) {
  const existing = recentPlayKeys.indexOf(key);
  if (existing >= 0) recentPlayKeys.splice(existing, 1);
  recentPlayKeys.push(key);
  if (recentPlayKeys.length > RECENT_PLAY_LIMIT) recentPlayKeys.shift();
}

function loadSimilarShuffle(): boolean {
  try {
    return localStorage.getItem(SIMILAR_SHUFFLE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSimilarShuffle(on: boolean) {
  try {
    localStorage.setItem(SIMILAR_SHUFFLE_KEY, on ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

interface PlaybackCacheMeta {
  provider: string;
  songId: string;
  quality: string;
  remoteUrl: string;
}

function loadCacheMode(): CacheMode {
  try {
    const raw = localStorage.getItem(CACHE_MODE_KEY);
    return raw === "after_play" ? "after_play" : "off";
  } catch {
    return "off";
  }
}

function saveCacheMode(mode: CacheMode) {
  try {
    localStorage.setItem(CACHE_MODE_KEY, mode);
  } catch {
    /* quota / private mode */
  }
}

function proxyStreamUrl(rawUrl: string, proxyPort: number): string {
  return `http://127.0.0.1:${proxyPort}/audio?url=${encodeURIComponent(rawUrl)}`;
}

function triggerAfterPlayCache(meta: PlaybackCacheMeta | null) {
  if (!meta || !isTauri()) return;
  void invoke("audio_cache_download", {
    provider: meta.provider,
    songId: meta.songId,
    quality: meta.quality,
    remoteUrl: meta.remoteUrl,
  }).catch(() => {});
}


function songKey(song: Pick<Song, "provider" | "id">): string {
  return `${song.provider}:${song.id}`;
}

const RECENT_KEY = "nexmusic-recent-plays";
const RECENT_LIMIT = 100;

function loadRecentPlays(): Song[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Song[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((song) => song && song.id && song.provider).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function saveRecentPlays(songs: Song[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(songs.slice(0, RECENT_LIMIT)));
  } catch {
    /* quota */
  }
}

const initialRecent = loadRecentPlays();
let playHistory: Song[] = [...initialRecent].reverse();
let historyIndex = playHistory.length - 1;
let untaggedToastKey = "";

function queueBase(playQueue: Song[], currentIndex: number, currentSong: Song | null): number {
  const at = playQueue[currentIndex];
  if (currentSong && at && at.id === currentSong.id && at.provider === currentSong.provider) return currentIndex;
  if (currentSong) {
    const found = playQueue.findIndex((song) => song.id === currentSong.id && song.provider === currentSong.provider);
    if (found >= 0) return found;
  }
  return currentIndex;
}

function recordHistory(song: Song) {
  const cut = playHistory.slice(0, Math.max(0, historyIndex + 1));
  const last = cut[cut.length - 1];
  if (!last || songKey(last) !== songKey(song)) cut.push(song);
  while (cut.length > RECENT_LIMIT) cut.shift();
  playHistory = cut;
  historyIndex = cut.length - 1;
  const recent = [...cut].reverse();
  saveRecentPlays(recent);
  const viewing = useMusicStore.getState().selectedPlaylist?.id === "recent";
  useMusicStore.setState({
    recentPlays: recent,
    playlistTracks: viewing ? recent : useMusicStore.getState().playlistTracks,
    selectedPlaylist: viewing
      ? { ...useMusicStore.getState().selectedPlaylist!, track_count: recent.length }
      : useMusicStore.getState().selectedPlaylist,
  });
}

export type SleepTimer =
  | { type: "off" }
  | { type: "minutes"; endsAt: number }
  | { type: "queue"; pending: string[] }
  | { type: "count"; left: number };

let sessionHydrated = false;
const initialSession = loadSession();
if (initialSession?.currentSong) {
  const restored = initialSession.currentSong;
  let at = -1;
  for (let i = playHistory.length - 1; i >= 0; i -= 1) {
    if (songKey(playHistory[i]) === songKey(restored)) {
      at = i;
      break;
    }
  }
  if (at >= 0) historyIndex = at;
  else {
    playHistory.push(restored);
    while (playHistory.length > RECENT_LIMIT) playHistory.shift();
    historyIndex = playHistory.length - 1;
    saveRecentPlays([...playHistory].reverse());
  }
}
let sleepClock: ReturnType<typeof setTimeout> | null = null;
let unbindAudio: (() => void) | null = null;

function clearSleepClock() {
  if (sleepClock != null) {
    clearTimeout(sleepClock);
    sleepClock = null;
  }
}

function withPlayCounts(entries: LocalEntry[]): Song[] {
  const counts = loadPlayCounts();
  return entries.map((entry) =>
    localEntryToSong(entry, counts[`local:${entry.path}`] ?? 0),
  );
}

export const LOCAL_PLAYLIST: Playlist = {
  provider: "local",
  id: "local",
  name: "本地音乐",
  cover: "",
  track_count: 0,
  creator: "",
  subscribed: false,
};

function loadPlayCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PLAY_COUNT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePlayCounts(map: Record<string, number>) {
  try {
    localStorage.setItem(PLAY_COUNT_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

function publishMediaSession(state: {
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}) {
  if (!state.currentSong) {
    stopMediaSession();
    return;
  }
  const durationMs =
    state.duration > 0 ? state.duration * 1000 : state.currentSong.duration || 0;
  syncMediaSession({
    title: state.currentSong.name,
    artist: state.currentSong.artist,
    cover: state.currentSong.cover || "",
    playing: state.isPlaying,
    durationMs,
    positionMs: state.currentTime * 1000,
  });
}

function stampLikedTracks(songs: Song[], playCounts: Record<string, number>): Song[] {
  const n = songs.length;
  return songs.map((song, i) => ({
    ...song,
    addedAt: n - i,
    playCount: playCounts[songKey(song)] ?? 0,
  }));
}

function triggerCatalogSync(provider: MusicProvider) {
  void import("@/stores/catalog-store").then(({ useCatalogStore }) => {
    const cat = useCatalogStore.getState();
    void cat.init().then(() => cat.maybeAutoSync(provider));
  });
}

export function sortLikedTracks(songs: Song[], key: LikedSortKey, asc: boolean): Song[] {
  const dir = asc ? 1 : -1;
  return [...songs].sort((a, b) => {
    let cmp = 0;
    if (key === "artist") cmp = (a.artist || "").localeCompare(b.artist || "", "zh");
    else if (key === "name") cmp = (a.name || "").localeCompare(b.name || "", "zh");
    else if (key === "addedAt") cmp = (a.addedAt ?? 0) - (b.addedAt ?? 0);
    else cmp = (a.playCount ?? 0) - (b.playCount ?? 0);
    if (cmp === 0) cmp = (a.addedAt ?? 0) - (b.addedAt ?? 0);
    return cmp * dir;
  });
}

interface MusicState {
  playbackSource: MusicProvider;
  loginInfos: Record<MusicProvider, LoginInfo | null>;
  loginInfo: LoginInfo | null;
  proxyPort: number;
  tab: TabId;
  userPlaylists: Playlist[];
  loadingPlaylists: boolean;
  playlistsError: string;
  selectedPlaylist: Playlist | null;
  playlistTracks: Song[];
  loadingTracks: boolean;
  searchKeyword: string;
  searchResults: Song[];
  searching: boolean;
  audioRef: HTMLAudioElement | null;
  currentSong: Song | null;
  playQueue: Song[];
  upNext: Song[];
  recentPlays: Song[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  volumeBarOpen: boolean;
  localLibrary: Song[];
  sleep: SleepTimer;
  playMode: PlayMode;
  similarShuffle: boolean;
  currentLyrics: Lyrics | null;
  toast: string;
  nowPlayingOpen: boolean;
  nowPlayingLyrics: boolean;
  loginOpen: boolean;
  androidLogin: { provider: MusicProvider; url: string } | null;
  likedSortKey: LikedSortKey;
  likedSortAsc: boolean;
  queueOpen: boolean;
  cacheMode: CacheMode;
  lastPlaybackCache: PlaybackCacheMeta | null;
  authReady: boolean;

  init: () => Promise<void>;
  setAudioRef: (el: HTMLAudioElement | null) => void;
  setTab: (tab: TabId) => void;
  switchProvider: (provider: MusicProvider) => Promise<void>;
  openLogin: (provider?: MusicProvider) => Promise<void>;
  tryCompleteLogin: () => Promise<boolean>;
  loginWithCookie: (cookie: string) => Promise<boolean>;
  logout: () => Promise<void>;
  loadUserPlaylists: () => Promise<void>;
  openPlaylist: (pl: Playlist) => Promise<void>;
  openPlaylistFromSongs: (pl: Playlist, songs: Song[]) => void;
  closePlaylist: () => void;
  setLikedSort: (key: LikedSortKey) => void;
  search: (keywords: string) => Promise<void>;
  playSong: (song: Song, opts?: { historyIndex?: number }) => Promise<void>;
  playNext: (song: Song) => void;
  openRecent: () => void;
  addToQueue: (songs: Song[]) => number;
  addListToQueue: (songs: Song[]) => void;
  replaceQueue: (songs: Song[]) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  setQueueOpen: (open: boolean) => void;
  setCacheMode: (mode: CacheMode) => void;
  setVolume: (volume: number) => void;
  setVolumeBarOpen: (open: boolean) => void;
  openLocalLibrary: () => void;
  importLocal: () => Promise<void>;
  removeLocal: (path: string) => void;
  startSleepMinutes: (minutes: number) => void;
  startSleepAfterQueue: () => void;
  startSleepAfterCount: (count: number) => void;
  cancelSleep: () => void;
  togglePlay: () => Promise<void>;
  cyclePlayMode: () => void;
  setSimilarShuffle: (on: boolean) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  seek: (time: number) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setNowPlayingLyrics: (open: boolean) => void;
  setLoginOpen: (open: boolean) => void;
  handleBack: () => Promise<boolean>;
}

function bumpPlayCount(song: Song) {
  const counts = loadPlayCounts();
  const key = songKey(song);
  counts[key] = (counts[key] ?? 0) + 1;
  savePlayCounts(counts);
  rememberPlay(key);
  const count = counts[key];
  const touch = (t: Song) =>
    t.id === song.id && t.provider === song.provider ? { ...t, playCount: count } : t;
  useMusicStore.setState((s) => ({
    currentSong: s.currentSong ? { ...s.currentSong, playCount: count } : s.currentSong,
    playlistTracks: s.playlistTracks.map(touch),
    playQueue: s.playQueue.map(touch),
    localLibrary: s.localLibrary.map(touch),
  }));
}

function stopForSleep(message: string) {
  clearSleepClock();
  const audio = useMusicStore.getState().audioRef;
  audio?.pause();
  useMusicStore.setState({ sleep: { type: "off" }, isPlaying: false, toast: message });
}

/** 自然播完一首时调用。返回 true 表示定时关闭已经停下，不要再切下一首。 */
function onNaturalTrackEnd(): boolean {
  const state = useMusicStore.getState();
  const sleep = state.sleep;
  if (sleep.type === "off") return false;
  if (sleep.type === "minutes") {
    if (Date.now() >= sleep.endsAt) {
      stopForSleep("定时关闭");
      return true;
    }
    return false;
  }
  if (sleep.type === "count") {
    const left = sleep.left - 1;
    if (left <= 0) {
      stopForSleep("已播完指定首数");
      return true;
    }
    useMusicStore.setState({ sleep: { type: "count", left } });
    return false;
  }
  if (state.playMode !== "shuffle") {
    const from = state.currentSong
      ? state.playQueue.findIndex((s) => s.id === state.currentSong?.id && s.provider === state.currentSong?.provider)
      : state.currentIndex;
    if (from < 0 || from >= state.playQueue.length - 1) {
      stopForSleep("列表已播完");
      return true;
    }
    return false;
  }
  const key = state.currentSong ? songKey(state.currentSong) : "";
  const pending = sleep.pending.filter((item) => item !== key);
  if (pending.length === 0) {
    stopForSleep("列表已播完");
    return true;
  }
  useMusicStore.setState({ sleep: { type: "queue", pending } });
  return false;
}

export const useMusicStore = create<MusicState>((set, get) => ({
  playbackSource: "qqmusic",
  loginInfos: { netease: null, kugou: null, qqmusic: null },
  loginInfo: null,
  proxyPort: 0,
  tab: "mine",
  userPlaylists: [],
  loadingPlaylists: false,
  playlistsError: "",
  selectedPlaylist: null,
  playlistTracks: [],
  loadingTracks: false,
  searchKeyword: "",
  searchResults: [],
  searching: false,
  audioRef: null,
  currentSong: initialSession?.currentSong ?? null,
  playQueue: initialSession?.playQueue ?? [],
  upNext: [],
  recentPlays: [...playHistory].reverse(),
  currentIndex: initialSession
    ? Math.min(initialSession.currentIndex, Math.max(0, initialSession.playQueue.length - 1))
    : 0,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: loadVolume(),
  volumeBarOpen: false,
  localLibrary: withPlayCounts(loadLocalLibrary()),
  sleep: { type: "off" },
  playMode: initialSession?.playMode ?? "list",
  similarShuffle: loadSimilarShuffle(),
  currentLyrics: null,
  toast: "",
  nowPlayingOpen: false,
  nowPlayingLyrics: false,
  loginOpen: false,
  androidLogin: null,
  likedSortKey: "addedAt",
  likedSortAsc: false,
  queueOpen: false,
  cacheMode: loadCacheMode(),
  lastPlaybackCache: null,
  authReady: false,

  init: async () => {
    try {
      const port = await invoke<number>("cmd_get_proxy_port");
      set({ proxyPort: port });
    } catch {
      /* ignore */
    }

    try {
      const saved = await invoke<string>("music_get_playback_source");
      if (saved === "qqmusic") {
        set({ playbackSource: "qqmusic" });
      } else if (saved === "netease" || saved === "kugou") {
        set({ playbackSource: "qqmusic" });
        try {
          await invoke("music_switch_provider", { provider: "qqmusic" });
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }

    for (const fn of unlistens) fn();
    unlistens = [];

    if (isTauri()) {
      bindMediaSessionControls({
        play: () => {
          if (!get().isPlaying) void get().togglePlay();
        },
        pause: () => {
          if (get().isPlaying) void get().togglePlay();
        },
        next: () => get().nextTrack(),
        prev: () => get().prevTrack(),
      });

      const onSuccess = async (provider: MusicProvider, info: LoginInfo) => {
        if (!info?.logged_in) return;
        const current = get().loginInfos[get().playbackSource];
        const shouldSwitch = !current?.logged_in;
        if (shouldSwitch) {
          set({ playbackSource: provider });
          try {
            await invoke("music_switch_provider", { provider });
          } catch {
            /* ignore */
          }
        }
        set((s) => ({
          loginInfo: shouldSwitch || s.playbackSource === provider ? info : s.loginInfo,
          loginInfos: { ...s.loginInfos, [provider]: info },
          loginOpen: false,
          androidLogin: null,
        }));
        get().loadUserPlaylists();
        triggerCatalogSync(provider);
      };

      try {
        unlistens.push(
          await listen<LoginInfo>("qqmusic-login-success", (e) => onSuccess("qqmusic", e.payload)),
        );
        unlistens.push(
          await listen<LoginInfo>("netease-login-success", (e) => onSuccess("netease", e.payload)),
        );
        unlistens.push(
          await listen<LoginInfo>("kugou-login-success", (e) => onSuccess("kugou", e.payload)),
        );
        unlistens.push(
          await listen<{ provider: MusicProvider; url: string }>("music-android-login", (e) => {
            set({ androidLogin: e.payload, loginOpen: true });
          }),
        );
        const onFail = (msg: string) => set({ toast: msg || "登录失败" });
        unlistens.push(await listen<string>("qqmusic-login-failed", (e) => onFail(String(e.payload || "登录失败"))));
        unlistens.push(await listen<string>("netease-login-failed", (e) => onFail(String(e.payload || "登录失败"))));
        unlistens.push(await listen<string>("kugou-login-failed", (e) => onFail(String(e.payload || "登录失败"))));
        try {
          const backListener = await addPluginListener("cookiebridge", "appBack", () => {
            void (async () => {
              const handled = await get().handleBack();
              if (!handled) {
                try {
                  await invoke("android_leave_app");
                } catch {
                  /* ignore */
                }
              }
            })();
          });
          unlistens.push(() => {
            void backListener.unregister();
          });
        } catch {
          /* plugin not on desktop */
        }
      } catch {
        /* browser / IPC not ready */
      }
    }

    try {
      const statuses = await Promise.race([
        invoke<Record<string, LoginInfo>>("music_get_login_statuses"),
        new Promise<Record<string, LoginInfo>>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), 10000);
        }),
      ]);
      const loginInfos: Record<MusicProvider, LoginInfo | null> = {
        netease: statuses.netease || null,
        kugou: statuses.kugou || null,
        qqmusic: statuses.qqmusic || null,
      };
      set({ loginInfos, loginInfo: loginInfos[get().playbackSource] });
    } catch {
      /* ignore */
    }

    if (get().loginInfo?.logged_in) {
      get().loadUserPlaylists();
      triggerCatalogSync(get().playbackSource);
    } else {
      void import("@/stores/catalog-store").then(({ useCatalogStore }) => {
        void useCatalogStore.getState().init();
      });
    }
    set({ authReady: true });
  },

  setAudioRef: (el) => {
    const prev = get().audioRef;
    if (prev === el) return;
    unbindAudio?.();
    unbindAudio = null;
    set({ audioRef: el });
    if (!el) return;
    el.volume = get().volume;
    let endedHandled = false;
    const onTime = () => {
      set({ currentTime: el.currentTime, duration: el.duration || 0 });
      const song = get().currentSong;
      maybeSyncPosition(get().isPlaying, (el.duration || 0) * 1000, el.currentTime * 1000, song);
    };
    const onPlay = () => {
      endedHandled = false;
      set({ isPlaying: true });
      publishMediaSession({ ...get(), isPlaying: true });
    };
    const onPause = () => {
      set({ isPlaying: false });
      publishMediaSession({ ...get(), isPlaying: false });
    };
    const onEnded = () => {
      if (endedHandled) return;
      endedHandled = true;
      if (onNaturalTrackEnd()) return;
      if (get().playMode === "one") {
        el.currentTime = 0;
        el.play().catch(() => {});
        return;
      }
      if (get().cacheMode === "after_play") {
        triggerAfterPlayCache(get().lastPlaybackCache);
      }
      get().nextTrack();
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    unbindAudio = () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  },

  setTab: (tab) => set({ tab }),

  switchProvider: async (provider) => {
    set({
      playbackSource: provider,
      loginInfo: get().loginInfos[provider],
      userPlaylists: [],
      selectedPlaylist: null,
      playlistTracks: [],
      searchResults: [],
    });
    try {
      await invoke("music_switch_provider", { provider });
    } catch {
      /* ignore */
    }
    if (get().loginInfos[provider]?.logged_in) {
      await get().loadUserPlaylists();
      triggerCatalogSync(provider);
    }
  },

  openLogin: async (provider) => {
    const target = provider || get().playbackSource;
    set({ loginOpen: true });
    if (!isTauri()) {
      set({ toast: "请在 NexMusic 桌面窗口中登录，浏览器无法打开官方登录" });
      return;
    }
    try {
      await invoke("music_open_login_window", { provider: target });
      set({ toast: "登录后请留在 QQ 音乐网页直到窗口关闭；若提示缺少播放授权，再点「我已完成登录」" });
    } catch (e) {
      set({ toast: invokeErrorMessage(e) });
    }
  },

  tryCompleteLogin: async () => {
    const provider = get().playbackSource;
    if (!isTauri()) {
      set({ toast: "请在 NexMusic 桌面窗口中完成登录" });
      return false;
    }
    try {
      const info = await invoke<LoginInfo>("music_try_complete_login", { provider });
      if (info.logged_in) {
        set((s) => ({
          loginInfos: { ...s.loginInfos, [provider]: info },
          loginInfo: info,
          loginOpen: false,
          androidLogin: null,
          toast: "",
        }));
        get().loadUserPlaylists();
        triggerCatalogSync(provider);
        return true;
      }
      set({ toast: "还没有读到登录信息，请先在弹出窗口内完成登录" });
      return false;
    } catch (e) {
      set({ toast: invokeErrorMessage(e) });
      return false;
    }
  },

  loginWithCookie: async (cookie) => {
    const provider = get().playbackSource;
    const cmd =
      provider === "kugou"
        ? "kugou_login_cookie"
        : provider === "qqmusic"
          ? "qq_login_cookie"
          : "music_login_cookie";
    try {
      const info = await invoke<LoginInfo>(cmd, { cookie });
      if (info.logged_in) {
        set((s) => ({
          loginInfos: { ...s.loginInfos, [provider]: info },
          loginInfo: info,
          loginOpen: false,
          androidLogin: null,
        }));
        get().loadUserPlaylists();
        triggerCatalogSync(provider);
        return true;
      }
      set({ toast: "Cookie 无效" });
      return false;
    } catch {
      set({ toast: "登录失败" });
      return false;
    }
  },

  logout: async () => {
    const provider = get().playbackSource;
    const cmd =
      provider === "kugou" ? "kugou_logout" : provider === "qqmusic" ? "qq_logout" : "music_logout";
    try {
      await invoke(cmd);
    } catch {
      /* ignore */
    }
    set((s) => ({
      loginInfos: { ...s.loginInfos, [provider]: null },
      loginInfo: null,
      userPlaylists: [],
      selectedPlaylist: null,
      playlistTracks: [],
    }));
  },

  loadUserPlaylists: async () => {
    const provider = get().playbackSource;
    set({ loadingPlaylists: true, playlistsError: "" });
    try {
      const cmd =
        provider === "kugou"
          ? "kugou_user_playlists"
          : provider === "qqmusic"
            ? "qq_user_playlists"
            : "music_user_playlist";
      const playlists = await invoke<Playlist[]>(cmd);
      set({ userPlaylists: playlists.filter(isKeptPlaylist), loadingPlaylists: false });
    } catch (e) {
      set({
        userPlaylists: [],
        playlistsError: typeof e === "string" && e ? e : "歌单获取失败，请重新登录",
        loadingPlaylists: false,
      });
    }
  },

  openPlaylist: async (pl) => {
    set({ selectedPlaylist: pl, loadingTracks: true, playlistTracks: [], tab: "mine" });
    const provider = get().playbackSource;
    const liked = isLikedPlaylist(pl);
    if (liked) {
      try {
        const { useCatalogStore } = await import("@/stores/catalog-store");
        const cat = useCatalogStore.getState();
        if (!cat.loaded) await cat.init();
        const cached = cat.likedPlayable(provider);
        if (cached.length > 0) {
          get().openPlaylistFromSongs({ ...pl, track_count: cached.length }, cached);
          return;
        }
      } catch {
        /* fall through to network */
      }
    }
    try {
      const cmd =
        provider === "kugou"
          ? "kugou_playlist_tracks"
          : provider === "qqmusic"
            ? "qq_playlist_tracks"
            : "music_playlist_tracks";
      const [meta, songs] = await invoke<[Playlist, Song[]]>(cmd, { id: pl.id });
      const treatLiked = liked || isLikedPlaylist(meta);
      const tracks = treatLiked ? stampLikedTracks(songs, loadPlayCounts()) : songs;
      const sorted = treatLiked
        ? sortLikedTracks(tracks, get().likedSortKey, get().likedSortAsc)
        : tracks;
      set({ selectedPlaylist: meta, playlistTracks: sorted, loadingTracks: false });
    } catch {
      set({ playlistTracks: [], loadingTracks: false, toast: "无法打开该歌单" });
    }
  },

  openPlaylistFromSongs: (pl, songs) => {
    const tracks = stampLikedTracks(songs, loadPlayCounts());
    const sorted = sortLikedTracks(tracks, get().likedSortKey, get().likedSortAsc);
    set({
      selectedPlaylist: { ...pl, track_count: songs.length },
      playlistTracks: sorted,
      loadingTracks: false,
    });
  },

  closePlaylist: () => set({ selectedPlaylist: null, playlistTracks: [] }),

  setLikedSort: (key) => {
    const { likedSortKey, likedSortAsc, playlistTracks } = get();
    const nextAsc = likedSortKey === key ? !likedSortAsc : key === "artist" || key === "name";
    const sorted = sortLikedTracks(playlistTracks, key, nextAsc);
    set({ likedSortKey: key, likedSortAsc: nextAsc, playlistTracks: sorted });
  },

  search: async (keywords) => {
    const q = keywords.trim();
    set({ searchKeyword: q });
    if (!q) {
      set({ searchResults: [] });
      return;
    }
    set({ searching: true, tab: "search" });
    const provider = get().playbackSource;
    let online: Song[] = [];
    try {
      const cmd =
        provider === "kugou" ? "kugou_search" : provider === "qqmusic" ? "qq_search" : "music_search";
      online = await invoke<Song[]>(cmd, { keywords: q, limit: 30 });
    } catch {
      online = [];
    }
    let mine = get().localLibrary;
    try {
      const { useCatalogStore } = await import("@/stores/catalog-store");
      const cat = useCatalogStore.getState();
      if (!cat.loaded) await cat.init();
      mine = [
        ...stampLikedTracks(
          cat.likedPlayable(provider).map((song) => ({ ...song, provider })),
          loadPlayCounts(),
        ),
        ...mine,
      ];
    } catch {
      /* 只用本地音乐 */
    }
    set({ searchResults: preferLibraryMatches(q, mine, online), searching: false });
  },

  playSong: async (song, opts) => {
    const idx = get().playQueue.findIndex((s) => s.id === song.id && s.provider === song.provider);
    if (idx >= 0) set({ currentIndex: idx });
    set({ currentSong: song, isPlaying: false, currentTime: 0, currentLyrics: null });

    const audio = get().audioRef;
    if (!audio) {
      set({ toast: "播放器未就绪，请再点一次播放" });
      return;
    }
    const mySeq = ++playSeq;
    audio.pause();
    audio.src = "";
    publishMediaSession({ currentSong: song, isPlaying: false, currentTime: 0, duration: 0 });

    const loadLyric = async () => {
      try {
        const lyrics =
          song.provider === "kugou"
            ? await invoke<Lyrics>("kugou_lyric", {
                hash: song.hash || song.id,
                albumAudioId: song.album_audio_id,
                duration: Math.floor(song.duration / 1000),
              })
            : song.provider === "qqmusic"
              ? await invoke<Lyrics>("qq_lyric", { mid: song.mid || song.id, id: song.id })
              : await invoke<Lyrics>("music_lyric", { id: song.id });
        if (mySeq === playSeq) set({ currentLyrics: lyrics });
        const translated = await maybeFillTranslation(song, lyrics);
        if (translated && mySeq === playSeq) set({ currentLyrics: translated });
      } catch {
        if (mySeq === playSeq) set({ currentLyrics: null });
      }
    };
    if (song.provider !== "local") void loadLyric();

    try {
      if (song.provider === "local") {
        let proxyPort = get().proxyPort;
        if (!proxyPort) {
          try {
            proxyPort = await invoke<number>("cmd_get_proxy_port");
            set({ proxyPort });
          } catch {
            set({ isPlaying: false, toast: "音频代理未启动" });
            return;
          }
        }
        if (mySeq !== playSeq) return;
        audio.src = `http://127.0.0.1:${proxyPort}/local?path=${encodeURIComponent(song.id)}`;
        audio.volume = get().volume;
        try {
          await audio.play();
        } catch {
          if (mySeq !== playSeq) return;
          set({ isPlaying: false, toast: "无法播放，文件可能已被移动或删除" });
          publishMediaSession({ currentSong: song, isPlaying: false, currentTime: 0, duration: 0 });
          return;
        }
        if (mySeq !== playSeq) return;
        set({ isPlaying: true, lastPlaybackCache: null });
        publishMediaSession({
          currentSong: song,
          isPlaying: true,
          currentTime: 0,
          duration: audio.duration || 0,
        });
        bumpPlayCount(song);
        if (typeof opts?.historyIndex === "number") historyIndex = opts.historyIndex;
        else recordHistory(song);
        return;
      }

      const quality = song.provider === "qqmusic" ? "hires" : "exhigh";
      const result =
        song.provider === "kugou"
          ? await invoke<SongUrlResult>("kugou_song_url", {
              hash: song.hash || song.id,
              albumId: song.album_id,
              albumAudioId: song.album_audio_id,
              quality,
              hqHash: song.hq_hash,
              sqHash: song.sq_hash,
              resHash: song.res_hash,
            })
          : song.provider === "qqmusic"
            ? await invoke<SongUrlResult>("qq_song_url", {
                mid: song.mid || song.id,
                mediaMid: song.media_mid,
                quality,
              })
            : await invoke<SongUrlResult>("music_song_url", { id: song.id, quality });

      if (mySeq !== playSeq) return;
      if (!result.playable || !result.url) {
        set({
          isPlaying: false,
          toast: result.message || "无法播放（版权或未登录）",
        });
        publishMediaSession({ currentSong: song, isPlaying: false, currentTime: 0, duration: 0 });
        setTimeout(() => {
          if (get().playQueue.length > 1) get().nextTrack();
        }, 800);
        return;
      }

      const { cacheMode } = get();
      let proxyPort = get().proxyPort;
      if (!proxyPort) {
        try {
          proxyPort = await invoke<number>("cmd_get_proxy_port");
          set({ proxyPort });
        } catch {
          set({ isPlaying: false, toast: "音频代理未启动" });
          return;
        }
      }

      const playbackMeta: PlaybackCacheMeta = {
        provider: song.provider,
        songId: song.id,
        quality,
        remoteUrl: result.url,
      };

      let audioUrl: string;
      if (cacheMode === "after_play") {
        const lookup = await invoke<{ hit: boolean; url: string }>("audio_cache_lookup", {
          provider: song.provider,
          songId: song.id,
          quality,
        });
        if (mySeq !== playSeq) return;
        audioUrl = lookup.hit ? lookup.url : proxyStreamUrl(result.url, proxyPort);
      } else {
        audioUrl = proxyStreamUrl(result.url, proxyPort);
      }

      audio.src = audioUrl;
      audio.volume = get().volume;
      try {
        await audio.play();
      } catch (playErr) {
        if (mySeq !== playSeq) return;
        const msg =
          playErr instanceof DOMException && playErr.name === "NotSupportedError"
            ? "无法播放该音质，请检查登录状态或稍后重试"
            : String(playErr);
        set({ isPlaying: false, toast: msg });
        publishMediaSession({ currentSong: song, isPlaying: false, currentTime: 0, duration: 0 });
        return;
      }
      set({ isPlaying: true, lastPlaybackCache: playbackMeta });
      publishMediaSession({
        currentSong: song,
        isPlaying: true,
        currentTime: 0,
        duration: audio.duration || 0,
      });
      bumpPlayCount(song);
      if (typeof opts?.historyIndex === "number") historyIndex = opts.historyIndex;
      else recordHistory(song);
    } catch (e) {
      if (mySeq !== playSeq) return;
      set({ isPlaying: false, toast: String(e) });
      publishMediaSession({ currentSong: song, isPlaying: false, currentTime: 0, duration: 0 });
    }
  },

  playNext: (song) => {
    const key = songKey(song);
    const current = get().currentSong;
    if (current && songKey(current) === key) {
      set({ toast: "正在播放这首" });
      return;
    }
    if (get().upNext.some((item) => songKey(item) === key)) {
      set({ toast: "已经在下一首" });
      return;
    }
    const state = get();
    const queue = [...state.playQueue];
    const existing = queue.findIndex((item) => songKey(item) === key);
    let currentAt = queueBase(queue, state.currentIndex, state.currentSong);
    if (existing >= 0) {
      queue.splice(existing, 1);
      if (existing < currentAt) currentAt -= 1;
    }
    const insertAt = Math.min(queue.length, Math.max(0, currentAt + 1 + state.upNext.length));
    queue.splice(insertAt, 0, song);
    const idx = state.currentSong
      ? queue.findIndex((item) => songKey(item) === songKey(state.currentSong!))
      : currentAt;
    set({
      playQueue: queue,
      currentIndex: idx >= 0 ? idx : 0,
      upNext: [...state.upNext, song],
      toast: "下一首播放",
    });
  },

  openRecent: () => {
    const songs = get().recentPlays;
    set({
      tab: "mine",
      selectedPlaylist: {
        provider: get().playbackSource,
        id: "recent",
        name: "最近播放",
        cover: songs[0]?.cover ?? "",
        track_count: songs.length,
        creator: "",
        subscribed: false,
      },
      playlistTracks: songs,
      loadingTracks: false,
    });
  },

  addToQueue: (songs) => {
    const { playQueue } = get();
    const keys = new Set(playQueue.map((s) => songKey(s)));
    const added = songs.filter((s) => {
      const k = songKey(s);
      if (keys.has(k)) return false;
      keys.add(k);
      return true;
    });
    if (added.length === 0) {
      set({ toast: songs.length === 1 ? "已在播放列表" : "这些歌都已在播放列表" });
      return 0;
    }
    set((s) => ({
      playQueue: [...s.playQueue, ...added],
      toast: songs.length === 1 ? "已加入播放列表" : s.toast,
    }));
    return added.length;
  },

  addListToQueue: (songs) => {
    const n = get().addToQueue(songs);
    if (n > 0 && songs.length > 1) set({ toast: `已加入 ${n} 首` });
    if (!get().currentSong && songs[0]) void get().playSong(songs[0]);
  },

  replaceQueue: (songs) => {
    if (songs.length === 0) {
      set({ toast: "列表是空的" });
      return;
    }
    const next = [...songs];
    set({ playQueue: next, upNext: [], currentIndex: 0, queueOpen: false });
    void get().playSong(next[0]);
  },

  removeFromQueue: (index) => {
    const { playQueue, currentIndex, currentSong, upNext } = get();
    if (index < 0 || index >= playQueue.length) return;
    const removed = playQueue[index];
    const next = playQueue.filter((_, i) => i !== index);
    let idx = currentIndex;
    if (index < currentIndex) idx -= 1;
    else if (index === currentIndex) {
      idx = Math.min(index, Math.max(0, next.length - 1));
    }
    if (currentSong) {
      const found = next.findIndex((s) => s.id === currentSong.id && s.provider === currentSong.provider);
      if (found >= 0) idx = found;
    }
    set({
      playQueue: next,
      currentIndex: next.length ? idx : 0,
      upNext: upNext.filter((item) => songKey(item) !== songKey(removed)),
    });
  },

  moveInQueue: (from, to) => {
    const { playQueue, currentIndex } = get();
    if (from === to || from < 0 || to < 0 || from >= playQueue.length || to >= playQueue.length) return;
    const next = [...playQueue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    let idx = currentIndex;
    if (currentIndex === from) idx = to;
    else if (from < currentIndex && to >= currentIndex) idx -= 1;
    else if (from > currentIndex && to <= currentIndex) idx += 1;
    set({ playQueue: next, currentIndex: idx });
  },

  clearQueue: () => set({ playQueue: [], upNext: [], currentIndex: 0, queueOpen: true }),

  setQueueOpen: (open) => set({ queueOpen: open }),

  setCacheMode: (mode) => {
    saveCacheMode(mode);
    set({ cacheMode: mode });
  },

  setVolume: (volume) => {
    const next = Math.min(1, Math.max(0, volume));
    saveVolume(next);
    const audio = get().audioRef;
    if (audio) audio.volume = next;
    set({ volume: next });
  },

  setVolumeBarOpen: (open) => set({ volumeBarOpen: open }),

  openLocalLibrary: () => {
    const songs = withPlayCounts(
      get().localLibrary.map((song) => ({ path: song.id, name: song.name, artist: song.artist })),
    );
    set({
      tab: "mine",
      selectedPlaylist: { ...LOCAL_PLAYLIST, track_count: songs.length },
      playlistTracks: songs,
      localLibrary: songs,
    });
  },

  importLocal: async () => {
    if (!isTauri()) {
      set({ toast: "请在 NexMusic 窗口中导入" });
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: "导入本地歌曲",
      filters: [{ name: "音频", extensions: ["mp3", "flac", "wav", "m4a", "ogg", "aac", "opus"] }],
    });
    if (picked == null) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const existing = new Set(get().localLibrary.map((song) => song.id));
    const added: Song[] = [];
    let failed = "";
    for (const source of paths) {
      try {
        const path = await invoke<string>("prepare_local_audio", { source });
        if (existing.has(path)) continue;
        existing.add(path);
        const parsed = parseLocalFileName(path);
        added.push(localEntryToSong({ path, name: parsed.name, artist: parsed.artist }));
      } catch (e) {
        failed = typeof e === "string" && e ? e : "导入失败";
      }
    }
    if (added.length === 0) {
      set({ toast: failed || "没有新的歌曲" });
      return;
    }
    const localLibrary = [...get().localLibrary, ...added];
    saveLocalLibrary(localLibrary.map((song) => ({ path: song.id, name: song.name, artist: song.artist })));
    const viewing = get().selectedPlaylist?.id === "local";
    set({
      localLibrary,
      playlistTracks: viewing ? localLibrary : get().playlistTracks,
      selectedPlaylist: viewing
        ? { ...LOCAL_PLAYLIST, track_count: localLibrary.length }
        : get().selectedPlaylist,
      toast: failed ? `已导入 ${added.length} 首，有文件失败` : `已导入 ${added.length} 首`,
    });
  },

  removeLocal: (path) => {
    const localLibrary = get().localLibrary.filter((song) => song.id !== path);
    saveLocalLibrary(localLibrary.map((song) => ({ path: song.id, name: song.name, artist: song.artist })));
    const viewing = get().selectedPlaylist?.id === "local";
    set({
      localLibrary,
      playlistTracks: viewing ? localLibrary : get().playlistTracks.filter((song) => song.id !== path || song.provider !== "local"),
      selectedPlaylist: viewing ? { ...LOCAL_PLAYLIST, track_count: localLibrary.length } : get().selectedPlaylist,
      playQueue: get().playQueue.filter((song) => !(song.provider === "local" && song.id === path)),
    });
  },

  startSleepMinutes: (minutes) => {
    clearSleepClock();
    const endsAt = Date.now() + minutes * 60_000;
    set({ sleep: { type: "minutes", endsAt }, toast: `${minutes} 分钟后关闭` });
    sleepClock = setTimeout(() => {
      if (get().sleep.type === "minutes") stopForSleep("定时关闭");
    }, minutes * 60_000);
  },

  startSleepAfterQueue: () => {
    clearSleepClock();
    const pending = [...new Set(get().playQueue.map((song) => songKey(song)))];
    if (pending.length === 0) {
      set({ toast: "播放列表是空的" });
      return;
    }
    set({ sleep: { type: "queue", pending }, toast: "播完列表后关闭" });
  },

  startSleepAfterCount: (count) => {
    clearSleepClock();
    const left = Math.max(1, Math.floor(count));
    set({ sleep: { type: "count", left }, toast: `再播 ${left} 首后关闭` });
  },

  cancelSleep: () => {
    clearSleepClock();
    set({ sleep: { type: "off" }, toast: "已取消定时关闭" });
  },

  togglePlay: async () => {
    const { audioRef, isPlaying, currentSong } = get();
    if (!audioRef) return;
    if (!currentSong) return;
    if (isPlaying) {
      audioRef.pause();
      return;
    }
    try {
      await audioRef.play();
    } catch {
      await get().playSong(currentSong);
    }
  },

  cyclePlayMode: () => {
    const i = PLAY_MODE_ORDER.indexOf(get().playMode);
    const next = PLAY_MODE_ORDER[(i + 1) % PLAY_MODE_ORDER.length];
    set({ playMode: next, toast: PLAY_MODE_LABEL[next] });
  },

  setSimilarShuffle: (on) => {
    saveSimilarShuffle(on);
    set({ similarShuffle: on, toast: on ? "同类随机已打开" : "同类随机已关闭" });
  },

  nextTrack: () => {
    const queuedNext = get().upNext;
    if (queuedNext.length > 0) {
      const [song, ...rest] = queuedNext;
      set({ upNext: rest });
      void get().playSong(song);
      return;
    }
    if (get().playMode === "shuffle" && historyIndex >= 0 && historyIndex < playHistory.length - 1) {
      const target = historyIndex + 1;
      void get().playSong(playHistory[target], { historyIndex: target });
      return;
    }
    const { playQueue, currentIndex, playMode, currentSong, similarShuffle } = get();
    if (playQueue.length === 0) return;
    const base = queueBase(playQueue, currentIndex, currentSong);
    const playAt = (index: number) => {
      const song = playQueue[index];
      if (song) void get().playSong(song);
    };
    const playUniform = () => {
      let next = Math.floor(Math.random() * playQueue.length);
      if (playQueue.length > 1 && next === base) next = (next + 1) % playQueue.length;
      playAt(next);
    };
    if (playMode !== "shuffle") {
      playAt(base + 1 >= playQueue.length ? 0 : base + 1);
      return;
    }
    if (!similarShuffle || playQueue.length < 2) {
      playUniform();
      return;
    }
    void import("@/stores/catalog-store").then(({ useCatalogStore }) => {
      const catalog = useCatalogStore.getState().cache.songs;
      const current = playQueue[base];
      const tags = tagsFromCatalog(
        catalog.find((item) => item.key === `${current?.provider}:${current?.id}`),
        current,
      );
      if (!current || !hasUsableTags(tags)) {
        const key = current ? `${current.provider}:${current.id}` : "";
        if (key && untaggedToastKey !== key) {
          untaggedToastKey = key;
          set({ toast: "这首还没有分类，改为普通随机" });
        }
        playUniform();
        return;
      }
      const picked = pickSimilarIndex(playQueue, base, catalog, new Set(recentPlayKeys));
      if (picked == null) {
        playUniform();
        return;
      }
      playAt(picked);
    }).catch(() => {
      playUniform();
    });
  },

  prevTrack: () => {
    const { playQueue, currentIndex, audioRef, currentSong, playMode } = get();
    if (audioRef && audioRef.currentTime > 3) {
      audioRef.currentTime = 0;
      return;
    }
    if (playMode === "shuffle") {
      if (historyIndex > 0) {
        const target = historyIndex - 1;
        void get().playSong(playHistory[target], { historyIndex: target });
      }
      return;
    }
    if (playQueue.length === 0) return;
    const base = queueBase(playQueue, currentIndex, currentSong);
    const prev = base <= 0 ? playQueue.length - 1 : base - 1;
    const song = playQueue[prev];
    if (song) void get().playSong(song);
  },

  seek: (time) => {
    const audio = get().audioRef;
    if (audio) audio.currentTime = time;
  },

  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open, nowPlayingLyrics: open ? get().nowPlayingLyrics : false }),
  setNowPlayingLyrics: (open) => set({ nowPlayingLyrics: open }),
  setLoginOpen: (open) => set({ loginOpen: open, androidLogin: open ? get().androidLogin : null }),

  handleBack: async () => {
    if (isTauri()) {
      try {
        const native = await invoke<boolean>("android_handle_back");
        if (native) return true;
      } catch {
        /* desktop / plugin missing */
      }
    }
    const s = get();
    if (s.queueOpen) {
      set({ queueOpen: false });
      return true;
    }
    if (s.nowPlayingOpen) {
      if (s.nowPlayingLyrics) {
        set({ nowPlayingLyrics: false });
        return true;
      }
      set({ nowPlayingOpen: false });
      return true;
    }
    if (s.selectedPlaylist) {
      get().closePlaylist();
      return true;
    }
    if (s.loginOpen) {
      set({ loginOpen: false, androidLogin: null });
      try {
        await invoke("android_close_login");
      } catch {
        /* ignore */
      }
      return true;
    }
    return false;
  },
}));

sessionHydrated = true;

useMusicStore.subscribe((state, prev) => {
  if (!sessionHydrated) return;
  if (
    state.playMode === prev.playMode &&
    state.currentSong === prev.currentSong &&
    state.playQueue === prev.playQueue &&
    state.currentIndex === prev.currentIndex
  ) {
    return;
  }
  saveSession({
    playMode: state.playMode,
    currentSong: state.currentSong,
    playQueue: state.playQueue,
    currentIndex: state.currentIndex,
  });
});
