import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  applyGuess,
  filterCatalog,
  findLikedPlaylist,
  likedSongsForProvider,
  mergeCloudIntoCache,
  normalizeCatalogSong,
  parseImportedCatalog,
  sleep,
} from "@/lib/catalog";
import {
  catalogToSong,
  emptyCatalog,
  isUnknownTag,
  songNeedsTags,
  type AiSongIn,
  type AiSongOut,
  type CatalogFile,
  type CatalogFilters,
  type CatalogSong,
} from "@/types/catalog";
import type { MusicProvider, Playlist, Song, TrackPage } from "@/types/music";
import { useMusicStore } from "@/stores/music-store";

const PAGE_GAP_MS = 400;
const AI_BATCH = 20;
const AI_GAP_MS = 400;

let syncLock = false;

function toast(msg: string) {
  useMusicStore.setState({ toast: msg });
}

function rangeCommand(provider: MusicProvider): string {
  if (provider === "kugou") return "kugou_playlist_tracks_range";
  if (provider === "qqmusic") return "qq_playlist_tracks_range";
  return "music_playlist_tracks_range";
}

function playlistsCommand(provider: MusicProvider): string {
  if (provider === "kugou") return "kugou_user_playlists";
  if (provider === "qqmusic") return "qq_user_playlists";
  return "music_user_playlist";
}

function pageSizeFor(provider: MusicProvider): number {
  if (provider === "qqmusic") return 200;
  return 50;
}

function refreshOpenLiked(provider: MusicProvider, cache: CatalogFile) {
  const music = useMusicStore.getState();
  const pl = music.selectedPlaylist;
  if (!pl) return;
  const liked =
    pl.id === "liked" ||
    pl.id === "qq-liked" ||
    /我喜欢的音乐|QQ 音乐·我的喜欢|^我喜欢/.test(pl.name);
  if (!liked) return;
  const songs = likedSongsForProvider(cache, provider).map(catalogToSong);
  music.openPlaylistFromSongs(pl, songs);
}

interface CatalogState {
  cache: CatalogFile;
  loaded: boolean;
  syncing: boolean;
  syncCurrent: number;
  syncTotal: number;
  syncMessage: string;
  tagging: boolean;
  tagCurrent: number;
  tagTotal: number;
  hasDeepseekKey: boolean;
  filters: CatalogFilters;
  editingKey: string | null;

  init: () => Promise<void>;
  persist: () => Promise<void>;
  maybeAutoSync: (provider: MusicProvider) => Promise<void>;
  syncLiked: (provider: MusicProvider) => Promise<void>;
  exportJson: () => void;
  importJson: (text: string) => Promise<void>;
  guessTags: () => Promise<void>;
  deepseekTag: () => Promise<void>;
  refreshKeyStatus: () => Promise<void>;
  saveDeepseekKey: (key: string) => Promise<void>;
  setFilters: (patch: Partial<CatalogFilters>) => void;
  setEditingKey: (key: string | null) => void;
  updateSongTags: (key: string, patch: Partial<CatalogSong>) => Promise<void>;
  filteredSongs: () => CatalogSong[];
  likedPlayable: (provider: MusicProvider) => Song[];
}

async function persistCache(cache: CatalogFile) {
  if (!isTauri()) return;
  await invoke("catalog_save", { data: cache });
}

async function fetchLikedPage(
  provider: MusicProvider,
  playlistId: string,
  start: number,
  count: number,
): Promise<TrackPage> {
  const raw = await invoke<TrackPage | Song[]>(rangeCommand(provider), {
    id: playlistId,
    start,
    count,
  });
  if (Array.isArray(raw)) {
    return { songs: raw, total: 0, hasMore: raw.length >= count };
  }
  return {
    songs: Array.isArray(raw.songs) ? raw.songs : [],
    total: raw.total ?? 0,
    hasMore: Boolean(raw.hasMore),
  };
}

function songIdKey(provider: MusicProvider, song: Song): string {
  return `${provider}:${song.id}`;
}

async function fetchAllLikedTracks(
  provider: MusicProvider,
  playlistId: string,
  onProgress: (songs: Song[], total: number) => Promise<void> | void,
): Promise<{ songs: Song[]; total: number }> {
  let pageSize = pageSizeFor(provider);
  let start = 0;
  let total = 0;
  const all: Song[] = [];
  const seen = new Set<string>();

  while (start < 20000) {
    let page: TrackPage;
    try {
      page = await fetchLikedPage(provider, playlistId, start, pageSize);
    } catch (e) {
      if (provider === "qqmusic" && pageSize > 100 && start === 0) {
        pageSize = 100;
        page = await fetchLikedPage(provider, playlistId, start, pageSize);
      } else {
        throw e;
      }
    }
    if (page.total > total) total = page.total;
    if (start === 0 && page.songs.length === 0 && pageSize > 100) {
      pageSize = 100;
      continue;
    }
    if (page.songs.length === 0) break;

    let added = 0;
    for (const song of page.songs) {
      const key = songIdKey(provider, song);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(song);
      added += 1;
    }
    await onProgress(all, total);
    if (added === 0) break;
    if (total > 0 && all.length >= total) break;
    if (!page.hasMore && (total === 0 || all.length >= total)) break;
    start += Math.max(page.songs.length, 1);
    await sleep(PAGE_GAP_MS);
  }
  return { songs: all, total };
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  cache: emptyCatalog(),
  loaded: false,
  syncing: false,
  syncCurrent: 0,
  syncTotal: 0,
  syncMessage: "",
  tagging: false,
  tagCurrent: 0,
  tagTotal: 0,
  hasDeepseekKey: false,
  filters: {
    language: "全部",
    artistCountry: "全部",
    musicType: "全部",
    styles: [],
    hideUnliked: true,
  },
  editingKey: null,

  init: async () => {
    if (get().loaded) return;
    try {
      if (isTauri()) {
        const data = await invoke<CatalogFile>("catalog_load");
        const cache: CatalogFile = {
          version: 1,
          syncedAt: data?.syncedAt ?? {},
          songs: Array.isArray(data?.songs) ? data.songs.map(normalizeCatalogSong) : [],
        };
        set({ cache, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
    await get().refreshKeyStatus();
  },

  persist: async () => {
    try {
      await persistCache(get().cache);
    } catch {
      toast("保存本机缓存失败");
    }
  },

  maybeAutoSync: async (provider) => {
    if (!get().loaded) await get().init();
    if (get().syncing) return;
    if (get().cache.syncedAt[provider]) return;
    toast("正在同步我喜欢到本机…");
    await get().syncLiked(provider);
  },

  syncLiked: async (provider) => {
    if (!isTauri()) {
      toast("请在 NexMusic 窗口中同步");
      return;
    }
    if (syncLock || get().syncing) return;
    syncLock = true;
    set({ syncing: true, syncCurrent: 0, syncTotal: 0, syncMessage: "正在读取歌单…" });
    try {
      const playlists = await invoke<Playlist[]>(playlistsCommand(provider));
      const liked = findLikedPlaylist(playlists);
      if (!liked) {
        throw new Error("没有找到「我喜欢」歌单，请确认已登录");
      }
      set({ syncMessage: `正在拉取「${liked.name}」…` });
      const { songs: cloud, total } = await fetchAllLikedTracks(provider, liked.id, async (songs, tot) => {
        const partial = mergeCloudIntoCache(get().cache, provider, songs, {
          markMissingUnliked: false,
          touchSyncedAt: false,
        });
        set({
          cache: partial,
          syncCurrent: songs.length,
          syncTotal: tot,
          syncMessage: tot ? `已拉取 ${songs.length} / ${tot} 首…` : `已拉取 ${songs.length} 首…`,
        });
      });
      if (cloud.length === 0) {
        throw new Error("没有拉到歌曲，请稍后重试");
      }
      const cache = mergeCloudIntoCache(get().cache, provider, cloud);
      const incomplete = total > 0 && cloud.length < total;
      const doneMsg = incomplete
        ? `已同步 ${cloud.length} / ${total} 首（未拉全，可稍后重试）`
        : `已同步 ${cloud.length} 首`;
      set({ cache, syncMessage: doneMsg, syncTotal: total });
      await persistCache(cache);
      refreshOpenLiked(provider, cache);
      toast(doneMsg + "到本机");
    } catch (e) {
      const msg = typeof e === "string" && e ? e : e instanceof Error ? e.message : "同步中断，可稍后重试";
      const pulled = get().syncCurrent;
      if (pulled > 0) {
        await persistCache(get().cache);
        toast(`${msg}（已写入 ${pulled} 首，未标取消喜欢）`);
      } else {
        toast(msg);
      }
      set({ syncMessage: msg });
    } finally {
      syncLock = false;
      set({ syncing: false });
    }
  },

  exportJson: () => {
    const blob = new Blob([JSON.stringify(get().cache, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexmusic-liked-cache.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("已导出本机缓存");
  },

  importJson: async (text) => {
    try {
      const parsed = parseImportedCatalog(JSON.parse(text));
      set({ cache: parsed });
      await persistCache(parsed);
      toast(`已导入 ${parsed.songs.length} 首`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "导入失败");
    }
  },

  guessTags: async () => {
    const { songs, filled } = applyGuess(get().cache.songs);
    const cache = { ...get().cache, songs };
    set({ cache });
    await persistCache(cache);
    toast(filled ? `规则猜测填写了 ${filled} 首` : "没有可猜的空字段");
  },

  deepseekTag: async () => {
    if (!isTauri()) {
      toast("请在 NexMusic 窗口中标注");
      return;
    }
    if (get().tagging) return;
    const pending = get().cache.songs.filter((s) => s.tagSource !== "manual" && songNeedsTags(s));
    if (pending.length === 0) {
      toast("没有需要 AI 填写的空字段");
      return;
    }
    const hasKey = await invoke<boolean>("catalog_has_deepseek_key");
    if (!hasKey) {
      set({ hasDeepseekKey: false });
      toast("请先保存 DeepSeek API Key");
      return;
    }
    set({ tagging: true, tagCurrent: 0, tagTotal: pending.length, hasDeepseekKey: true });
    const byKey = new Map(get().cache.songs.map((s) => [s.key, s]));
    try {
      for (let i = 0; i < pending.length; i += AI_BATCH) {
        const batch = pending.slice(i, i + AI_BATCH);
        const payload: AiSongIn[] = batch.map((s) => ({
          key: s.key,
          name: s.name,
          artist: s.artist,
          album: s.album,
        }));
        const tagged = await invoke<AiSongOut[]>("catalog_ai_tag", { songs: payload });
        for (const item of tagged) {
          const song = byKey.get(item.key);
          if (!song || song.tagSource === "manual") continue;
          let changed = false;
          const next: CatalogSong = { ...song, styles: [...song.styles] };
          if (isUnknownTag(next.language) && item.language) {
            next.language = item.language;
            changed = true;
          }
          if (isUnknownTag(next.artistCountry) && item.artistCountry) {
            next.artistCountry = item.artistCountry;
            changed = true;
          }
          if (isUnknownTag(next.musicType) && item.musicType) {
            next.musicType = item.musicType;
            changed = true;
          }
          if (isUnknownTag(next.artistGender) && item.artistGender) {
            next.artistGender = item.artistGender;
            changed = true;
          }
          if (next.styles.length === 0 && item.styles?.length) {
            next.styles = item.styles.slice(0, 3);
            changed = true;
          }
          if (changed) {
            next.tagSource = "deepseek";
            byKey.set(item.key, next);
          }
        }
        const cache: CatalogFile = { ...get().cache, songs: [...byKey.values()] };
        set({ cache, tagCurrent: Math.min(i + batch.length, pending.length) });
        await persistCache(cache);
        if (i + AI_BATCH < pending.length) await sleep(AI_GAP_MS);
      }
      toast("AI 标注完成");
    } catch (e) {
      const msg = typeof e === "string" && e ? e : e instanceof Error ? e.message : "AI 标注中断";
      toast(msg);
    } finally {
      set({ tagging: false });
    }
  },

  refreshKeyStatus: async () => {
    try {
      if (!isTauri()) return;
      const has = await invoke<boolean>("catalog_has_deepseek_key");
      set({ hasDeepseekKey: has });
    } catch {
      set({ hasDeepseekKey: false });
    }
  },

  saveDeepseekKey: async (key) => {
    if (!isTauri()) {
      toast("请在 NexMusic 窗口中保存 Key");
      return;
    }
    await invoke("catalog_set_deepseek_key", { key });
    set({ hasDeepseekKey: key.trim().length > 0 });
    toast(key.trim() ? "已保存 DeepSeek Key" : "已清除 DeepSeek Key");
  },

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setEditingKey: (key) => set({ editingKey: key }),

  updateSongTags: async (key, patch) => {
    const songs = get().cache.songs.map((s) =>
      s.key === key ? { ...s, ...patch, tagSource: "manual" as const } : s,
    );
    const cache = { ...get().cache, songs };
    set({ cache, editingKey: null });
    await persistCache(cache);
  },

  filteredSongs: () => filterCatalog(get().cache.songs, get().filters),
  likedPlayable: (provider) => likedSongsForProvider(get().cache, provider).map(catalogToSong),
}));

export { formatSyncedAt } from "@/lib/catalog";
