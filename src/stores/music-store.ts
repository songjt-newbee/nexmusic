import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isLikedPlaylist } from "@/lib/catalog";
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

export type TabId = "mine" | "search" | "classify";

function isKeptPlaylist(pl: Playlist): boolean {
  if (pl.id === "liked") return true;
  if (pl.subscribed) return true;
  return /喜欢|我喜欢|like/i.test(pl.name);
}

async function proxyAudioUrl(rawUrl: string, proxyPort: number): Promise<string> {
  let port = proxyPort;
  if (!port) port = await invoke<number>("cmd_get_proxy_port");
  return `http://127.0.0.1:${port}/audio?url=${encodeURIComponent(rawUrl)}`;
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

function songKey(song: Pick<Song, "provider" | "id">): string {
  return `${song.provider}:${song.id}`;
}

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
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playMode: PlayMode;
  currentLyrics: Lyrics | null;
  toast: string;
  nowPlayingOpen: boolean;
  loginOpen: boolean;
  androidLogin: { provider: MusicProvider; url: string } | null;
  likedSortKey: LikedSortKey;
  likedSortAsc: boolean;
  queueOpen: boolean;

  init: () => Promise<void>;
  setAudioRef: (el: HTMLAudioElement | null) => void;
  setTab: (tab: TabId) => void;
  switchProvider: (provider: MusicProvider) => Promise<void>;
  openLogin: (provider?: MusicProvider) => Promise<void>;
  loginWithCookie: (cookie: string) => Promise<boolean>;
  logout: () => Promise<void>;
  loadUserPlaylists: () => Promise<void>;
  openPlaylist: (pl: Playlist) => Promise<void>;
  openPlaylistFromSongs: (pl: Playlist, songs: Song[]) => void;
  closePlaylist: () => void;
  setLikedSort: (key: LikedSortKey) => void;
  search: (keywords: string) => Promise<void>;
  playSong: (song: Song) => Promise<void>;
  addToQueue: (songs: Song[]) => number;
  addListToQueue: (songs: Song[]) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  setQueueOpen: (open: boolean) => void;
  togglePlay: () => Promise<void>;
  cyclePlayMode: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  seek: (time: number) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setLoginOpen: (open: boolean) => void;
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
  currentSong: null,
  playQueue: [],
  currentIndex: 0,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  playMode: "list",
  currentLyrics: null,
  toast: "",
  nowPlayingOpen: false,
  loginOpen: false,
  androidLogin: null,
  likedSortKey: "addedAt",
  likedSortAsc: false,
  queueOpen: false,

  init: async () => {
    try {
      const port = await invoke<number>("cmd_get_proxy_port");
      set({ proxyPort: port });
    } catch {
      /* ignore */
    }

    try {
      const saved = await invoke<string>("music_get_playback_source");
      if (saved === "netease" || saved === "kugou" || saved === "qqmusic") {
        set({ playbackSource: saved });
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
      } catch {
        /* browser / IPC not ready */
      }
    }

    try {
      const statuses = await invoke<Record<string, LoginInfo>>("music_get_login_statuses");
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
  },

  setAudioRef: (el) => {
    const prev = get().audioRef;
    if (prev === el) return;
    set({ audioRef: el });
    if (!el) return;
    el.addEventListener("timeupdate", () => {
      set({ currentTime: el.currentTime, duration: el.duration || 0 });
      const song = get().currentSong;
      maybeSyncPosition(get().isPlaying, (el.duration || 0) * 1000, el.currentTime * 1000, song);
    });
    el.addEventListener("play", () => {
      set({ isPlaying: true });
      publishMediaSession({ ...get(), isPlaying: true });
    });
    el.addEventListener("pause", () => {
      set({ isPlaying: false });
      publishMediaSession({ ...get(), isPlaying: false });
    });
    el.addEventListener("ended", () => {
      if (get().playMode === "one") {
        el.currentTime = 0;
        el.play().catch(() => {});
        return;
      }
      get().nextTrack();
    });
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
    } catch (e) {
      set({ toast: invokeErrorMessage(e) });
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
    try {
      const provider = get().playbackSource;
      const cmd =
        provider === "kugou" ? "kugou_search" : provider === "qqmusic" ? "qq_search" : "music_search";
      const results = await invoke<Song[]>(cmd, { keywords: q, limit: 30 });
      set({ searchResults: results });
    } catch {
      set({ searchResults: [] });
    } finally {
      set({ searching: false });
    }
  },

  playSong: async (song) => {
    const audio = get().audioRef;
    if (!audio) return;
    const mySeq = ++playSeq;
    audio.pause();
    audio.src = "";

    const idx = get().playQueue.findIndex((s) => s.id === song.id && s.provider === song.provider);
    if (idx >= 0) set({ currentIndex: idx });

    set({ currentSong: song, isPlaying: false, currentTime: 0, currentLyrics: null });
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
      } catch {
        if (mySeq === playSeq) set({ currentLyrics: null });
      }
    };
    void loadLyric();

    try {
      const quality = "exhigh";
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

      const audioUrl = await proxyAudioUrl(result.url, get().proxyPort);
      if (mySeq !== playSeq) return;
      audio.src = audioUrl;
      audio.volume = get().volume;
      await audio.play();
      set({ isPlaying: true });
      publishMediaSession({
        currentSong: song,
        isPlaying: true,
        currentTime: 0,
        duration: audio.duration || 0,
      });
      const counts = loadPlayCounts();
      const key = songKey(song);
      counts[key] = (counts[key] ?? 0) + 1;
      savePlayCounts(counts);
      const count = counts[key];
      set((s) => ({
        currentSong: s.currentSong ? { ...s.currentSong, playCount: count } : s.currentSong,
        playlistTracks: s.playlistTracks.map((t) =>
          t.id === song.id && t.provider === song.provider ? { ...t, playCount: count } : t,
        ),
        playQueue: s.playQueue.map((t) =>
          t.id === song.id && t.provider === song.provider ? { ...t, playCount: count } : t,
        ),
      }));
    } catch (e) {
      if (mySeq !== playSeq) return;
      set({ isPlaying: false, toast: String(e) });
      publishMediaSession({ currentSong: song, isPlaying: false, currentTime: 0, duration: 0 });
    }
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

  removeFromQueue: (index) => {
    const { playQueue, currentIndex, currentSong } = get();
    if (index < 0 || index >= playQueue.length) return;
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
    set({ playQueue: next, currentIndex: next.length ? idx : 0 });
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

  clearQueue: () => set({ playQueue: [], currentIndex: 0, queueOpen: true }),

  setQueueOpen: (open) => set({ queueOpen: open }),

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

  nextTrack: () => {
    const { playQueue, currentIndex, playMode, currentSong } = get();
    if (playQueue.length === 0) return;
    const from = currentSong
      ? playQueue.findIndex((s) => s.id === currentSong.id && s.provider === currentSong.provider)
      : currentIndex;
    const base = from >= 0 ? from : currentIndex;
    let next = base + 1;
    if (playMode === "shuffle") {
      next = Math.floor(Math.random() * playQueue.length);
      if (playQueue.length > 1 && next === base) next = (next + 1) % playQueue.length;
    } else if (next >= playQueue.length) {
      next = 0;
    }
    const song = playQueue[next];
    if (song) get().playSong(song);
  },

  prevTrack: () => {
    const { playQueue, currentIndex, audioRef, currentSong } = get();
    if (audioRef && audioRef.currentTime > 3) {
      audioRef.currentTime = 0;
      return;
    }
    if (playQueue.length === 0) return;
    const from = currentSong
      ? playQueue.findIndex((s) => s.id === currentSong.id && s.provider === currentSong.provider)
      : currentIndex;
    const base = from >= 0 ? from : currentIndex;
    const prev = base <= 0 ? playQueue.length - 1 : base - 1;
    const song = playQueue[prev];
    if (song) get().playSong(song);
  },

  seek: (time) => {
    const audio = get().audioRef;
    if (audio) audio.currentTime = time;
  },

  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
  setLoginOpen: (open) => set({ loginOpen: open, androidLogin: open ? get().androidLogin : null }),
}));
