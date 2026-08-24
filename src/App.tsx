import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  ChevronLeft,
  GripVertical,
  Heart,
  ListMusic,
  ListPlus,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Tags,
  Trash2,
  User,
  X,
} from "lucide-react";
import { ClassifyTab, LikedSyncBar } from "@/ClassifyTab";
import { isLikedPlaylist } from "@/lib/catalog";
import { catalogToSong } from "@/types/catalog";
import { buildKaraokeLines } from "@/lib/karaoke-lyrics";
import { coverProxyUrl, useMusicStore } from "@/stores/music-store";
import { useCatalogStore } from "@/stores/catalog-store";
import {
  PLAY_MODE_LABEL,
  PROVIDERS,
  UI_PROVIDERS,
  type LikedSortKey,
  type MusicProvider,
  type PlayMode,
  type Song,
} from "@/types/music";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

function PlayModeIcon({ mode, size = 20 }: { mode: PlayMode; size?: number }) {
  if (mode === "shuffle") return <Shuffle size={size} />;
  if (mode === "one") return <Repeat1 size={size} />;
  return <Repeat size={size} />;
}

const LIKED_SORTS: { key: LikedSortKey; label: string }[] = [
  { key: "artist", label: "歌手" },
  { key: "name", label: "歌曲" },
  { key: "addedAt", label: "添加时间" },
  { key: "playCount", label: "播放次数" },
];

function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function SongList({ songs }: { songs: Song[] }) {
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const playSong = useMusicStore((s) => s.playSong);
  const addToQueue = useMusicStore((s) => s.addToQueue);
  const addListToQueue = useMusicStore((s) => s.addListToQueue);
  if (songs.length === 0) return <p className="empty">暂无歌曲</p>;
  return (
    <div>
      <div className="list-actions">
        <button
          className="icon-btn"
          title="将当前列表加入播放列表"
          onClick={() => addListToQueue(songs)}
        >
          <ListPlus size={18} />
        </button>
      </div>
      {songs.map((song) => (
        <div key={`${song.provider}-${song.id}`} className="song-row" onClick={() => void playSong(song)}>
          <img className="cover" src={coverProxyUrl(song.cover, proxyPort)} alt="" />
          <div className="meta">
            <b>{song.name}</b>
            <span>{song.artist}</span>
          </div>
          <button
            className="icon-btn"
            title="加入播放列表"
            onClick={(e) => {
              e.stopPropagation();
              addToQueue([song]);
            }}
          >
            <Plus size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function QueueSheet() {
  const open = useMusicStore((s) => s.queueOpen);
  const setQueueOpen = useMusicStore((s) => s.setQueueOpen);
  const playQueue = useMusicStore((s) => s.playQueue);
  const currentSong = useMusicStore((s) => s.currentSong);
  const playSong = useMusicStore((s) => s.playSong);
  const removeFromQueue = useMusicStore((s) => s.removeFromQueue);
  const moveInQueue = useMusicStore((s) => s.moveInQueue);
  const clearQueue = useMusicStore((s) => s.clearQueue);
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const dragFrom = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  if (!open) return null;

  const onPointerMove = (e: PointerEvent) => {
    if (dragFrom.current === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest("[data-queue-index]") as HTMLElement | null;
    if (!row) return;
    const idx = Number(row.dataset.queueIndex);
    if (Number.isFinite(idx)) setOver(idx);
  };

  const endDrag = () => {
    if (dragFrom.current !== null && over !== null && dragFrom.current !== over) {
      moveInQueue(dragFrom.current, over);
    }
    dragFrom.current = null;
    setOver(null);
  };

  return (
    <div className="sheet queue-sheet" onClick={() => setQueueOpen(false)}>
      <div className="sheet-card queue-card" onClick={(e) => e.stopPropagation()}>
        <div className="queue-head">
          <b>播放列表 · {playQueue.length}</b>
          <button className="ghost" onClick={() => clearQueue()} disabled={playQueue.length === 0}>
            清空
          </button>
        </div>
        <div className="queue-list" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {playQueue.length === 0 ? <p className="empty" style={{ marginTop: 24 }}>还没有歌曲，用加号加入</p> : null}
          {playQueue.map((song, i) => {
            const active = currentSong?.id === song.id && currentSong.provider === song.provider;
            return (
              <div
                key={`${song.provider}-${song.id}-${i}`}
                data-queue-index={i}
                className={`song-row queue-row${active ? " active" : ""}${over === i ? " drop" : ""}`}
              >
                <button
                  className="icon-btn grip"
                  title="拖动排序"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    dragFrom.current = i;
                    setOver(i);
                  }}
                >
                  <GripVertical size={16} />
                </button>
                <img
                  className="cover"
                  src={coverProxyUrl(song.cover, proxyPort)}
                  alt=""
                  onClick={() => void playSong(song)}
                />
                <div className="meta" onClick={() => void playSong(song)}>
                  <b>{song.name}</b>
                  <span>{song.artist}</span>
                </div>
                <button
                  className="icon-btn"
                  title="移出列表"
                  onClick={() => removeFromQueue(i)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LoginSheet() {
  const loginOpen = useMusicStore((s) => s.loginOpen);
  const androidLogin = useMusicStore((s) => s.androidLogin);
  const playbackSource = useMusicStore((s) => s.playbackSource);
  const setLoginOpen = useMusicStore((s) => s.setLoginOpen);
  const loginWithCookie = useMusicStore((s) => s.loginWithCookie);
  const openLogin = useMusicStore((s) => s.openLogin);
  const [cookie, setCookie] = useState("");

  if (!loginOpen) return null;
  const providerName = PROVIDERS.find((p) => p.id === playbackSource)?.name ?? "音乐";

  return (
    <div className="sheet" onClick={() => setLoginOpen(false)}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <b>登录 {providerName}</b>
          <button className="icon-btn" onClick={() => setLoginOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          桌面会弹出官方登录窗口。Android 可在系统浏览器登录后，把 Cookie 粘贴到下方。
        </p>
        {androidLogin ? (
          <p style={{ fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>
            登录页：{androidLogin.url}
          </p>
        ) : null}
        <button
          className="primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => {
            if (androidLogin?.url) {
              void openUrl(androidLogin.url);
            } else {
              void openLogin();
            }
          }}
        >
          打开官方登录
        </button>
        <textarea
          placeholder="也可粘贴 Cookie（含 uin / qm_keyst 或 MUSIC_U）"
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
        />
        <button className="ghost" style={{ width: "100%" }} onClick={() => loginWithCookie(cookie)}>
          用 Cookie 登录
        </button>
      </div>
    </div>
  );
}

function NowPlaying() {
  const open = useMusicStore((s) => s.nowPlayingOpen);
  const song = useMusicStore((s) => s.currentSong);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const currentTime = useMusicStore((s) => s.currentTime);
  const duration = useMusicStore((s) => s.duration);
  const lyrics = useMusicStore((s) => s.currentLyrics);
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const togglePlay = useMusicStore((s) => s.togglePlay);
  const nextTrack = useMusicStore((s) => s.nextTrack);
  const prevTrack = useMusicStore((s) => s.prevTrack);
  const seek = useMusicStore((s) => s.seek);
  const setNowPlayingOpen = useMusicStore((s) => s.setNowPlayingOpen);
  const playMode = useMusicStore((s) => s.playMode);
  const cyclePlayMode = useMusicStore((s) => s.cyclePlayMode);
  const setQueueOpen = useMusicStore((s) => s.setQueueOpen);
  const lines = useMemo(() => buildKaraokeLines(lyrics), [lyrics]);
  const active = lines.findIndex((l, i) => currentTime >= l.time && currentTime < (lines[i + 1]?.time ?? 1e9));
  const coverUrl = song ? coverProxyUrl(song.cover, proxyPort) : "";
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (!open || active < 0) return;
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active, open]);

  if (!open || !song) return null;

  return (
    <div className="overlay now-playing">
      <div className="topbar">
        <button className="icon-btn" onClick={() => setNowPlayingOpen(false)}>
          <ChevronLeft />
        </button>
        <span className="brand">正在播放</span>
        <button className="icon-btn" title="播放列表" onClick={() => setQueueOpen(true)}>
          <ListMusic />
        </button>
      </div>

      <div
        className="now-playing-lyrics"
        style={{ backgroundImage: coverUrl ? `url("${coverUrl}")` : undefined }}
      >
        <div className="now-playing-lyrics-inner lyrics">
          {lines.length === 0 ? <p className="empty-lyrics">暂无歌词</p> : null}
          {lines.map((line, i) => (
            <p
              key={`${line.time}-${i}`}
              ref={i === active ? activeLineRef : undefined}
              className={i === active ? "active" : ""}
            >
              {line.text}
              {line.translation ? (
                <>
                  <br />
                  <span className="lyric-trans">{line.translation}</span>
                </>
              ) : null}
            </p>
          ))}
        </div>
      </div>

      <div className="now-playing-controls">
        <div className="now-playing-meta">
          <b>{song.name}</b>
          <span>{song.artist}</span>
        </div>
        <input
          className="progress"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime || 0}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <div className="progress-times">
          <span>{fmt(currentTime)}</span>
          <span>{fmt(duration)}</span>
        </div>
        <div className="controls">
          <button onClick={prevTrack}>
            <SkipBack />
          </button>
          <button className="play-btn" onClick={() => void togglePlay()}>
            {isPlaying ? <Pause /> : <Play />}
          </button>
          <button onClick={nextTrack}>
            <SkipForward />
          </button>
          <button className="mode-btn" title={PLAY_MODE_LABEL[playMode]} onClick={() => cyclePlayMode()}>
            <PlayModeIcon mode={playMode} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const init = useMusicStore((s) => s.init);
  const setAudioRef = useMusicStore((s) => s.setAudioRef);
  const tab = useMusicStore((s) => s.tab);
  const setTab = useMusicStore((s) => s.setTab);
  const playbackSource = useMusicStore((s) => s.playbackSource);
  const switchProvider = useMusicStore((s) => s.switchProvider);
  const loginInfo = useMusicStore((s) => s.loginInfo);
  const openLogin = useMusicStore((s) => s.openLogin);
  const logout = useMusicStore((s) => s.logout);
  const playlists = useMusicStore((s) => s.userPlaylists);
  const loadingPlaylists = useMusicStore((s) => s.loadingPlaylists);
  const playlistsError = useMusicStore((s) => s.playlistsError);
  const selectedPlaylist = useMusicStore((s) => s.selectedPlaylist);
  const playlistTracks = useMusicStore((s) => s.playlistTracks);
  const loadingTracks = useMusicStore((s) => s.loadingTracks);
  const openPlaylist = useMusicStore((s) => s.openPlaylist);
  const closePlaylist = useMusicStore((s) => s.closePlaylist);
  const search = useMusicStore((s) => s.search);
  const searchKeyword = useMusicStore((s) => s.searchKeyword);
  const searchResults = useMusicStore((s) => s.searchResults);
  const searching = useMusicStore((s) => s.searching);
  const currentSong = useMusicStore((s) => s.currentSong);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const togglePlay = useMusicStore((s) => s.togglePlay);
  const nextTrack = useMusicStore((s) => s.nextTrack);
  const prevTrack = useMusicStore((s) => s.prevTrack);
  const cyclePlayMode = useMusicStore((s) => s.cyclePlayMode);
  const playMode = useMusicStore((s) => s.playMode);
  const setNowPlayingOpen = useMusicStore((s) => s.setNowPlayingOpen);
  const setQueueOpen = useMusicStore((s) => s.setQueueOpen);
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const toast = useMusicStore((s) => s.toast);
  const likedSortKey = useMusicStore((s) => s.likedSortKey);
  const likedSortAsc = useMusicStore((s) => s.likedSortAsc);
  const setLikedSort = useMusicStore((s) => s.setLikedSort);
  const openPlaylistFromSongs = useMusicStore((s) => s.openPlaylistFromSongs);
  const cacheMode = useMusicStore((s) => s.cacheMode);
  const setCacheMode = useMusicStore((s) => s.setCacheMode);
  const catalogInit = useCatalogStore((s) => s.init);
  const maybeAutoSync = useCatalogStore((s) => s.maybeAutoSync);
  const catalogCache = useCatalogStore((s) => s.cache);

  useEffect(() => {
    void init();
    void catalogInit();
  }, [init, catalogInit]);

  useEffect(() => {
    if (loginInfo?.logged_in) void maybeAutoSync(playbackSource);
  }, [loginInfo?.logged_in, playbackSource, maybeAutoSync]);

  useEffect(() => {
    setAudioRef(audioRef.current);
  }, [setAudioRef]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useMusicStore.setState({ toast: "" }), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="app">
      <audio ref={audioRef} preload="none" />
      {toast ? <div className="toast">{toast}</div> : null}

      <div className="topbar">
        <span className="brand">NexMusic</span>
        <div className="provider-switch">
          {UI_PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={playbackSource === p.id ? "active" : ""}
              onClick={() => void switchProvider(p.id as MusicProvider)}
            >
              {p.name.replace(" 音乐", "").replace("网易云", "云")}
            </button>
          ))}
        </div>
        <button
          className="user-chip"
          onClick={() => {
            if (loginInfo?.logged_in) {
              if (window.confirm("退出当前平台登录？")) void logout();
            } else {
              void openLogin();
            }
          }}
        >
          {loginInfo?.avatar ? (
            <img src={coverProxyUrl(loginInfo.avatar, proxyPort)} alt="" />
          ) : (
            <span className="avatar" style={{ display: "grid", placeItems: "center" }}>
              <User size={14} />
            </span>
          )}
          <span style={{ fontSize: 12, maxWidth: 72, overflow: "hidden", textOverflow: "ellipsis" }}>
            {loginInfo?.logged_in ? loginInfo.nickname || "已登录" : "登录"}
          </span>
        </button>
      </div>

      <div className="scroll">
        {tab === "mine" && !selectedPlaylist ? (
          !loginInfo?.logged_in ? (
            <div className="hero-login">
              <Heart color="#1ecd9a" size={42} />
              <h2>登录后查看收藏</h2>
              <p>只展示「我喜欢」和收藏的歌单</p>
              <button className="primary" onClick={() => void openLogin()}>
                登录
              </button>
            </div>
          ) : loadingPlaylists ? (
            <p className="empty">正在加载歌单…</p>
          ) : playlistsError ? (
            <p className="empty">{playlistsError}</p>
          ) : (
            <>
              <div className="cache-setting">
                <label>
                  <input
                    type="checkbox"
                    checked={cacheMode === "after_play"}
                    onChange={(e) => setCacheMode(e.target.checked ? "after_play" : "off")}
                  />
                  <span>播完后缓存到本机</span>
                </label>
                <p>开启后整首播完才下载，不占首播速度；需足够磁盘空间</p>
              </div>
              <div className="section-title">我的歌单</div>
              <LikedSyncBar />
              {playlists.length === 0 ? <p className="empty">还没有收藏歌单</p> : null}
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="playlist-row"
                  onClick={() => {
                    if (isLikedPlaylist(pl)) {
                      const cached = catalogCache.songs
                        .filter((s) => s.sources.includes(playbackSource) && s.inLiked)
                        .map(catalogToSong);
                      if (cached.length > 0) {
                        openPlaylistFromSongs(pl, cached);
                        return;
                      }
                    }
                    void openPlaylist(pl);
                  }}
                >
                  <img className="cover" src={coverProxyUrl(pl.cover, proxyPort)} alt="" />
                  <div className="meta">
                    <b>{pl.name}</b>
                    <span>
                      {isLikedPlaylist(pl)
                        ? `${catalogCache.songs.filter((s) => s.sources.includes(playbackSource) && s.inLiked).length || pl.track_count} 首`
                        : `${pl.track_count} 首`}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )
        ) : null}

        {tab === "mine" && selectedPlaylist ? (
          <>
            <button className="ghost back" onClick={closePlaylist}>
              <ChevronLeft size={16} /> 返回
            </button>
            <h2 style={{ margin: "4px 0 12px" }}>{selectedPlaylist.name}</h2>
            {isLikedPlaylist(selectedPlaylist) ? (
              <>
                <LikedSyncBar />
                <div className="sort-bar">
                  {LIKED_SORTS.map((item) => {
                    const active = likedSortKey === item.key;
                    return (
                      <button
                        key={item.key}
                        className={active ? "active" : ""}
                        onClick={() => setLikedSort(item.key)}
                      >
                        {item.label}
                        {active ? (likedSortAsc ? " ↑" : " ↓") : ""}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
            {loadingTracks ? (
              <p className="empty">加载歌曲…</p>
            ) : (
              <SongList songs={playlistTracks} />
            )}
          </>
        ) : null}

        {tab === "classify" ? <ClassifyTab /> : null}

        {tab === "search" ? (
          <>
            <input
              className="search-box"
              placeholder="搜索歌曲"
              defaultValue={searchKeyword}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search((e.target as HTMLInputElement).value);
              }}
            />
            {searching ? <p className="empty">搜索中…</p> : null}
            <SongList songs={searchResults} />
          </>
        ) : null}
      </div>

      {currentSong ? (
        <div className="mini" onClick={() => setNowPlayingOpen(true)}>
          <img className="cover" src={coverProxyUrl(currentSong.cover, proxyPort)} alt="" />
          <div className="meta">
            <b>{currentSong.name}</b>
            <span>{currentSong.artist}</span>
          </div>
          <div className="mini-controls">
            <button
              className="icon-btn"
              title="上一首"
              onClick={(e) => {
                e.stopPropagation();
                prevTrack();
              }}
            >
              <SkipBack size={16} />
            </button>
            <button
              className="icon-btn"
              title={isPlaying ? "暂停" : "播放"}
              onClick={(e) => {
                e.stopPropagation();
                void togglePlay();
              }}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              className="icon-btn"
              title="下一首"
              onClick={(e) => {
                e.stopPropagation();
                nextTrack();
              }}
            >
              <SkipForward size={16} />
            </button>
            <button
              className="icon-btn"
              title={PLAY_MODE_LABEL[playMode]}
              onClick={(e) => {
                e.stopPropagation();
                cyclePlayMode();
              }}
            >
              <PlayModeIcon mode={playMode} size={16} />
            </button>
            <button
              className="icon-btn"
              title="播放列表"
              onClick={(e) => {
                e.stopPropagation();
                setQueueOpen(true);
              }}
            >
              <ListMusic size={16} />
            </button>
          </div>
        </div>
      ) : null}

      <nav className="tabs">
        <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>
          <ListMusic size={18} />
          <div>我的</div>
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
          <Search size={18} />
          <div>搜索</div>
        </button>
        <button className={tab === "classify" ? "active" : ""} onClick={() => setTab("classify")}>
          <Tags size={18} />
          <div>分类</div>
        </button>
      </nav>

      <NowPlaying />
      <QueueSheet />
      <LoginSheet />
    </div>
  );
}
