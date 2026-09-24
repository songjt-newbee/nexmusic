import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  ChevronLeft,
  GripVertical,
  Heart,
  History,
  Info,
  ListMusic,
  ListStart,
  ListPlus,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Tags,
  Trash2,
  User,
  Volume2,
  X,
} from "lucide-react";
import { ClassifyTab, LikedSyncBar } from "@/ClassifyTab";
import { SettingsTab } from "@/SettingsTab";
import { isLikedPlaylist, likedSongsForProvider } from "@/lib/catalog";
import { matchesListQuery } from "@/lib/list-query";
import { catalogToSong, isUnknownTag } from "@/types/catalog";
import { buildKaraokeLines } from "@/lib/karaoke-lyrics";
import { coverProxyUrl, useMusicStore, type SleepTimer } from "@/stores/music-store";
import { useCatalogStore } from "@/stores/catalog-store";
import {
  PLAY_MODE_LABEL,
  PROVIDERS,
  UI_PROVIDERS,
  type LikedSortKey,
  type MusicProvider,
  type KaraokeLine,
  type Lyrics,
  type PlayMode,
  type Song,
} from "@/types/music";
import { MainScroll, useScrollParent, VirtualRows } from "@/virtual-list";
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

function SongList({
  songs,
  showPlayCount,
  onRemove,
  playAll,
}: {
  songs: Song[];
  showPlayCount?: boolean;
  onRemove?: (song: Song) => void;
  playAll?: boolean;
}) {
  const scrollElement = useScrollParent();
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const playSong = useMusicStore((s) => s.playSong);
  const addToQueue = useMusicStore((s) => s.addToQueue);
  const playNext = useMusicStore((s) => s.playNext);
  const addListToQueue = useMusicStore((s) => s.addListToQueue);
  const replaceQueue = useMusicStore((s) => s.replaceQueue);
  const catalogSongs = useCatalogStore((s) => s.cache.songs);
  const [query, setQuery] = useState("");
  const catalogByKey = useMemo(
    () => new Map(catalogSongs.map((song) => [song.key, song])),
    [catalogSongs],
  );
  const shown = useMemo(
    () => songs.filter((song) => matchesListQuery(song, query, catalogByKey.get(`${song.provider}:${song.id}`))),
    [songs, query, catalogByKey],
  );
  if (songs.length === 0) return <p className="empty">暂无歌曲</p>;
  return (
    <div>
      <input
        className="list-search"
        value={query}
        placeholder="搜索歌名、歌手、专辑或分类"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="list-actions">
        {playAll ? (
          <button className="ghost" onClick={() => replaceQueue(shown)}>
            播放全部
          </button>
        ) : (
          <span />
        )}
        <button
          className="icon-btn"
          title="将当前列表加入播放列表"
          onClick={() => addListToQueue(shown)}
        >
          <ListPlus size={18} />
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="empty">没有匹配的歌曲</p>
      ) : (
      <VirtualRows
        count={shown.length}
        scrollElement={scrollElement}
        renderRow={(i) => {
          const song = shown[i];
          return (
            <div className="song-row" onClick={() => void playSong(song)}>
              {song.cover ? (
                <img className="cover" src={coverProxyUrl(song.cover, proxyPort)} alt="" loading="lazy" decoding="async" />
              ) : (
                <div className="cover local-cover">本地</div>
              )}
              <div className="meta">
                <b>{song.name}</b>
                <span>
                  {song.artist}
                  {showPlayCount ? ` · 听过 ${song.playCount ?? 0} 次` : ""}
                </span>
              </div>
              <button
                className="icon-btn"
                title="下一首播放"
                onClick={(e) => {
                  e.stopPropagation();
                  playNext(song);
                }}
              >
                <ListStart size={16} />
              </button>
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
              {onRemove ? (
                <button
                  className="icon-btn"
                  title="从本地音乐移除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(song);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          );
        }}
      />
      )}
    </div>
  );
}

function QueueSheet() {
  const open = useMusicStore((s) => s.queueOpen);
  const setQueueOpen = useMusicStore((s) => s.setQueueOpen);
  const playQueue = useMusicStore((s) => s.playQueue);
  const currentIndex = useMusicStore((s) => s.currentIndex);
  const currentSong = useMusicStore((s) => s.currentSong);
  const playSong = useMusicStore((s) => s.playSong);
  const removeFromQueue = useMusicStore((s) => s.removeFromQueue);
  const playNext = useMusicStore((s) => s.playNext);
  const moveInQueue = useMusicStore((s) => s.moveInQueue);
  const clearQueue = useMusicStore((s) => s.clearQueue);
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [listNode, setListNode] = useState<HTMLDivElement | null>(null);
  const setList = useRef((node: HTMLDivElement | null) => {
    listRef.current = node;
    setListNode(node);
  }).current;
  const dragFrom = useRef<number | null>(null);
  const dragPoint = useRef<{ x: number; y: number } | null>(null);
  const overRef = useRef<number | null>(null);
  const scrolling = useRef(false);
  const [over, setOver] = useState<number | null>(null);
  const catalogSongs = useCatalogStore((s) => s.cache.songs);
  const [queueQuery, setQueueQuery] = useState("");
  const catalogByKey = useMemo(
    () => new Map(catalogSongs.map((song) => [song.key, song])),
    [catalogSongs],
  );
  const queueRows = useMemo(() => {
    const rows: { song: Song; index: number }[] = [];
    playQueue.forEach((song, index) => {
      if (matchesListQuery(song, queueQuery, catalogByKey.get(`${song.provider}:${song.id}`))) {
        rows.push({ song, index });
      }
    });
    return rows;
  }, [playQueue, queueQuery, catalogByKey]);

  const pickOver = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const row = el?.closest("[data-queue-index]") as HTMLElement | null;
    if (!row) return;
    const idx = Number(row.dataset.queueIndex);
    if (!Number.isFinite(idx) || overRef.current === idx) return;
    overRef.current = idx;
    setOver(idx);
  };

  const stopDragScroll = () => {
    scrolling.current = false;
  };

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      frame = requestAnimationFrame(tick);
      if (!scrolling.current) return;
      const list = listRef.current;
      const pt = dragPoint.current;
      if (!list || !pt) return;
      const rect = list.getBoundingClientRect();
      const edge = 56;
      if (pt.y < rect.top + edge) list.scrollTop -= 18;
      else if (pt.y > rect.bottom - edge) list.scrollTop += 18;
      pickOver(pt.x, pt.y);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [open]);

  if (!open) return null;

  const onPointerMove = (e: PointerEvent) => {
    if (dragFrom.current === null) return;
    dragPoint.current = { x: e.clientX, y: e.clientY };
    pickOver(e.clientX, e.clientY);
  };

  const endDrag = () => {
    if (dragFrom.current !== null && overRef.current !== null && dragFrom.current !== overRef.current) {
      moveInQueue(dragFrom.current, overRef.current);
    }
    dragFrom.current = null;
    dragPoint.current = null;
    overRef.current = null;
    stopDragScroll();
    setOver(null);
  };

  const queued = playQueue[currentIndex];
  const indexMatchesSong =
    queued != null && currentSong?.id === queued.id && currentSong.provider === queued.provider;

  return (
    <div className="sheet queue-sheet" onClick={() => setQueueOpen(false)}>
      <div className="sheet-card queue-card" onClick={(e) => e.stopPropagation()}>
        <div className="queue-head">
          <b>播放列表 · {playQueue.length}</b>
          <button className="ghost" onClick={() => clearQueue()} disabled={playQueue.length === 0}>
            清空
          </button>
        </div>
        <input
          className="list-search"
          value={queueQuery}
          placeholder="搜索歌名、歌手、专辑或分类"
          onChange={(e) => setQueueQuery(e.target.value)}
        />
        <div
          className="queue-list"
          ref={setList}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {playQueue.length === 0 ? <p className="empty" style={{ marginTop: 24 }}>还没有歌曲，用加号加入</p> : queueRows.length === 0 ? (
            <p className="empty" style={{ marginTop: 24 }}>没有匹配的歌曲</p>
          ) : listNode ? (
            <VirtualRows
              count={queueRows.length}
              scrollElement={listNode}
              focusIndex={queueRows.findIndex((row) => row.index === currentIndex)}
              renderRow={(rowIndex) => {
                const { song, index: i } = queueRows[rowIndex];
                const active = indexMatchesSong
                  ? i === currentIndex
                  : currentSong?.id === song.id && currentSong.provider === song.provider;
                return (
                  <div
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
                        dragPoint.current = { x: e.clientX, y: e.clientY };
                        overRef.current = i;
                        setOver(i);
                        scrolling.current = true;
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
                      title="下一首播放"
                      onClick={() => playNext(song)}
                    >
                      <ListStart size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      title="移出列表"
                      onClick={() => removeFromQueue(i)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              }}
            />
          ) : null}
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
  const tryCompleteLogin = useMusicStore((s) => s.tryCompleteLogin);
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
          请在 <b style={{ color: "var(--text)" }}>App 弹出的登录窗口</b> 内完成 QQ 登录，不要跳到系统浏览器。
          登录后请在窗口里停留在 QQ 音乐网页（会自动打开播放页）直到窗口自己关闭，这样才能拿到播放授权。
          手机上会在当前 App 内打开登录页（使用系统自带网页组件，不会额外增大安装包）。
        </p>
        {androidLogin ? (
          <p style={{ fontSize: 12, color: "var(--accent)" }}>已打开 App 内登录页，完成后会自动返回。</p>
        ) : null}
        <button
          className="primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => {
            void openLogin();
          }}
        >
          打开官方登录
        </button>
        <button
          className="ghost"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => {
            void tryCompleteLogin();
          }}
        >
          我已完成登录
        </button>
        <details style={{ marginTop: 12 }}>
          <summary style={{ color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>高级：粘贴 Cookie</summary>
          <textarea
            placeholder="含 uin / qm_keyst 或 MUSIC_U"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
          />
          <button className="ghost" style={{ width: "100%" }} onClick={() => loginWithCookie(cookie)}>
            用 Cookie 登录
          </button>
        </details>
      </div>
    </div>
  );
}

function RecentEntry() {
  const count = useMusicStore((s) => s.recentPlays.length);
  const openRecent = useMusicStore((s) => s.openRecent);
  return (
    <div className="playlist-row" onClick={() => openRecent()}>
      <div className="cover local-cover">最近</div>
      <div className="meta">
        <b>最近播放</b>
        <span>{count} 首</span>
      </div>
    </div>
  );
}

function LocalLibraryEntry() {
  const count = useMusicStore((s) => s.localLibrary.length);
  const openLocalLibrary = useMusicStore((s) => s.openLocalLibrary);
  return (
    <div className="playlist-row" onClick={() => openLocalLibrary()}>
      <div className="cover local-cover">本地</div>
      <div className="meta">
        <b>本地音乐</b>
        <span>{count} 首</span>
      </div>
    </div>
  );
}

function lyricIndex(lines: KaraokeLine[], time: number) {
  return lines.findIndex((line, i) => time >= line.time && time < (lines[i + 1]?.time ?? 1e9));
}

function Playhead() {
  const currentTime = useMusicStore((s) => s.currentTime);
  const duration = useMusicStore((s) => s.duration);
  const seek = useMusicStore((s) => s.seek);
  return (
    <>
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
    </>
  );
}

function LyricPane({ lyrics }: { lyrics: Lyrics | null }) {
  const lines = useMemo(() => buildKaraokeLines(lyrics), [lyrics]);
  const active = useMusicStore((s) => lyricIndex(lines, s.currentTime));
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (active < 0) return;
    activeLineRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [active]);

  if (lines.length === 0) return <p className="empty-lyrics">暂无歌词 · 点击返回封面</p>;
  return (
    <>
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
    </>
  );
}

function sleepLabel(sleep: SleepTimer, now: number): string {
  if (sleep.type === "minutes") {
    const left = Math.max(0, sleep.endsAt - now);
    const minutes = Math.floor(left / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")} 后关闭`;
  }
  if (sleep.type === "count") return `再播 ${sleep.left} 首后关闭`;
  if (sleep.type === "queue") return "播完列表后关闭";
  return "";
}

function MatchList({ title, songs, onClose }: { title: string; songs: Song[]; onClose: () => void }) {
  const playSong = useMusicStore((s) => s.playSong);
  const playNext = useMusicStore((s) => s.playNext);
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  return (
    <div className="sheet detail-sheet" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="sheet-card queue-card" onClick={(e) => e.stopPropagation()}>
        <div className="queue-head">
          <b>{title} · {songs.length}</b>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="queue-list" ref={setNode}>
          {songs.length === 0 ? <p className="empty">我喜欢里没有匹配的歌</p> : null}
          {node && songs.length > 0 ? (
            <VirtualRows
              count={songs.length}
              scrollElement={node}
              renderRow={(i) => {
                const song = songs[i];
                return (
                  <div className="song-row">
                    <img className="cover" src={coverProxyUrl(song.cover, proxyPort)} alt="" onClick={() => void playSong(song)} />
                    <div className="meta" onClick={() => void playSong(song)}>
                      <b>{song.name}</b>
                      <span>{song.artist}</span>
                    </div>
                    <button className="icon-btn" title="下一首播放" onClick={() => playNext(song)}>
                      <ListStart size={16} />
                    </button>
                  </div>
                );
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SongDetail({ song, onClose }: { song: Song; onClose: () => void }) {
  const playbackSource = useMusicStore((s) => s.playbackSource);
  const cache = useCatalogStore((s) => s.cache);
  const [match, setMatch] = useState<{ title: string; songs: Song[] } | null>(null);
  const tagged = cache.songs.find((item) => item.key === `${song.provider}:${song.id}`);
  const language = tagged?.language || "未知";
  const country = tagged?.artistCountry || "未知";
  const gender = tagged?.artistGender || "未知";
  const musicType = tagged?.musicType || "未知";
  const styles = tagged?.styles ?? [];
  const album = tagged?.album || song.album;
  const artistNames = (tagged?.artists?.map((artist) => artist.name).filter(Boolean) ?? []);
  if (artistNames.length === 0 && song.artist) artistNames.push(song.artist);

  const liked = likedSongsForProvider(cache, playbackSource);
  const openMatch = (title: string, picked: typeof liked) => {
    setMatch({ title, songs: picked.map(catalogToSong) });
  };

  return (
    <div className="sheet detail-sheet" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="queue-head">
          <b>{song.name}</b>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="detail-fields">
          {artistNames.map((name) => (
            <button key={name} className="detail-field" onClick={() => openMatch(`歌手 · ${name}`, liked.filter((item) => item.artist === name || item.artists.some((artist) => artist.name === name)))}>
              <span>歌手</span>
              <b>{name}</b>
            </button>
          ))}
          {album ? (
            <button className="detail-field" onClick={() => openMatch(`专辑 · ${album}`, liked.filter((item) => item.album === album))}>
              <span>专辑</span>
              <b>{album}</b>
            </button>
          ) : (
            <p className="detail-static"><span>专辑</span>未知</p>
          )}
          {isUnknownTag(language) ? (
            <p className="detail-static"><span>语言</span>未知</p>
          ) : (
            <button className="detail-field" onClick={() => openMatch(`语言 · ${language}`, liked.filter((item) => item.language === language))}>
              <span>语言</span>
              <b>{language}</b>
            </button>
          )}
          <p className="detail-static"><span>国家</span>{country}</p>
          <p className="detail-static"><span>性别</span>{gender}</p>
          <p className="detail-static"><span>类型</span>{musicType}</p>
          {styles.length === 0 ? <p className="detail-static"><span>风格</span>未知</p> : styles.map((style) => (
            <button key={style} className="detail-field" onClick={() => openMatch(`风格 · ${style}`, liked.filter((item) => item.styles.includes(style)))}>
              <span>风格</span>
              <b>{style}</b>
            </button>
          ))}
        </div>
      </div>
      {match ? <MatchList title={match.title} songs={match.songs} onClose={() => setMatch(null)} /> : null}
    </div>
  );
}

function RecentSheet({ onClose }: { onClose: () => void }) {
  const recentPlays = useMusicStore((s) => s.recentPlays);
  const playSong = useMusicStore((s) => s.playSong);
  const currentSong = useMusicStore((s) => s.currentSong);
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const songs = recentPlays.slice(0, 20);
  return (
    <div className="sheet queue-sheet" onClick={onClose}>
      <div className="sheet-card queue-card" onClick={(e) => e.stopPropagation()}>
        <div className="queue-head">
          <b>最近播放 · {songs.length}</b>
        </div>
        <div className="queue-list">
          {songs.length === 0 ? (
            <p className="empty" style={{ marginTop: 24 }}>还没有播放记录</p>
          ) : (
            songs.map((item, index) => {
              const active = currentSong?.id === item.id && currentSong.provider === item.provider;
              return (
                <div
                  key={`${item.provider}:${item.id}:${index}`}
                  className={`song-row queue-row${active ? " active" : ""}`}
                  onClick={() => void playSong(item)}
                >
                  {item.cover ? (
                    <img className="cover" src={coverProxyUrl(item.cover, proxyPort)} alt="" />
                  ) : (
                    <div className="cover local-cover">本地</div>
                  )}
                  <div className="meta">
                    <b>{item.name}</b>
                    <span>{item.artist}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function NowPlaying() {
  const open = useMusicStore((s) => s.nowPlayingOpen);
  const song = useMusicStore((s) => s.currentSong);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const lyrics = useMusicStore((s) => s.currentLyrics);
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const togglePlay = useMusicStore((s) => s.togglePlay);
  const nextTrack = useMusicStore((s) => s.nextTrack);
  const prevTrack = useMusicStore((s) => s.prevTrack);
  const setNowPlayingOpen = useMusicStore((s) => s.setNowPlayingOpen);
  const nowPlayingLyrics = useMusicStore((s) => s.nowPlayingLyrics);
  const setNowPlayingLyrics = useMusicStore((s) => s.setNowPlayingLyrics);
  const playMode = useMusicStore((s) => s.playMode);
  const cyclePlayMode = useMusicStore((s) => s.cyclePlayMode);
  const setQueueOpen = useMusicStore((s) => s.setQueueOpen);
  const volume = useMusicStore((s) => s.volume);
  const setVolume = useMusicStore((s) => s.setVolume);
  const volumeBarOpen = useMusicStore((s) => s.volumeBarOpen);
  const setVolumeBarOpen = useMusicStore((s) => s.setVolumeBarOpen);
  const sleep = useMusicStore((s) => s.sleep);
  const cancelSleep = useMusicStore((s) => s.cancelSleep);
  const [now, setNow] = useState(() => Date.now());
  const [detailOpen, setDetailOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const coverUrl = song ? coverProxyUrl(song.cover, proxyPort) : "";
  const volumeDockRef = useRef<HTMLDivElement | null>(null);
  const volumeHideTimer = useRef<number | null>(null);
  const armVolumeHide = () => {
    if (volumeHideTimer.current) window.clearTimeout(volumeHideTimer.current);
    volumeHideTimer.current = window.setTimeout(() => setVolumeBarOpen(false), 2000);
  };

  useEffect(() => {
    if (!open || sleep.type !== "minutes") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, sleep.type]);

  useEffect(() => {
    if (!open) {
      setVolumeBarOpen(false);
      setRecentOpen(false);
    }
  }, [open, setVolumeBarOpen]);

  useEffect(() => {
    if (!volumeBarOpen) return;
    armVolumeHide();
    const onPointerDown = (event: Event) => {
      const dock = volumeDockRef.current;
      if (dock && event.target instanceof Node && dock.contains(event.target)) {
        armVolumeHide();
        return;
      }
      setVolumeBarOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      if (volumeHideTimer.current) window.clearTimeout(volumeHideTimer.current);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [volumeBarOpen, setVolumeBarOpen]);

  if (!open || !song) return null;

  return (
    <div className="overlay now-playing">
      <div className="topbar">
        <button className="icon-btn" onClick={() => setNowPlayingOpen(false)}>
          <ChevronLeft />
        </button>
        <span className="brand">正在播放</span>
        <div className="volume-dock" ref={volumeDockRef}>
          {volumeBarOpen ? (
            <input
              className="volume-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              aria-label="应用音量"
              onChange={(e) => {
                setVolume(Number(e.target.value) / 100);
                armVolumeHide();
              }}
            />
          ) : null}
          <button
            className="icon-btn"
            title={volumeBarOpen ? "收起音量" : "音量"}
            onClick={() => setVolumeBarOpen(!volumeBarOpen)}
          >
            <Volume2 />
          </button>
        </div>
      </div>

      <div
        className="now-playing-stage"
        style={{ backgroundImage: coverUrl ? `url("${coverUrl}")` : undefined }}
        onClick={() => setNowPlayingLyrics(!nowPlayingLyrics)}
      >
        {nowPlayingLyrics ? (
          <div className="now-playing-lyrics-inner lyrics">
            <LyricPane lyrics={lyrics} />
          </div>
        ) : (
          <div className="now-playing-cover-wrap">
            {coverUrl ? <img className="now-cover" src={coverUrl} alt="" /> : <div className="now-cover now-cover-empty" />}
            <p className="lyric-hint">点击封面查看歌词</p>
          </div>
        )}
      </div>

      <div className="now-playing-controls">
        <div className="now-playing-meta">
          <b>{song.name}</b>
          <span>{song.artist}</span>
          {sleep.type !== "off" ? (
            <button className="sleep-chip" onClick={() => cancelSleep()}>
              {sleepLabel(sleep, now)} · 取消
            </button>
          ) : null}
        </div>
        <Playhead />
        <div className="controls">
          <button title="最近播放" onClick={() => setRecentOpen(true)}>
            <History />
          </button>
          <button title="歌曲详情" onClick={() => setDetailOpen(true)}>
            <Info />
          </button>
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
          <button className="mode-btn" title="播放列表" onClick={() => setQueueOpen(true)}>
            <ListMusic />
          </button>
        </div>
      </div>
      {recentOpen ? <RecentSheet onClose={() => setRecentOpen(false)} /> : null}
      {detailOpen ? <SongDetail song={song} onClose={() => setDetailOpen(false)} /> : null}
    </div>
  );
}

export default function App() {
  const init = useMusicStore((s) => s.init);
  const setAudioRef = useMusicStore((s) => s.setAudioRef);
  const bindAudio = useRef((el: HTMLAudioElement | null) => {
    setAudioRef(el);
  }).current;
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
  const importLocal = useMusicStore((s) => s.importLocal);
  const removeLocal = useMusicStore((s) => s.removeLocal);
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
  const authReady = useMusicStore((s) => s.authReady);
  const handleBack = useMusicStore((s) => s.handleBack);
  const catalogInit = useCatalogStore((s) => s.init);
  const maybeAutoSync = useCatalogStore((s) => s.maybeAutoSync);
  const catalogCache = useCatalogStore((s) => s.cache);
  const likedCount = useMemo(
    () => catalogCache.songs.filter((s) => s.sources.includes(playbackSource) && s.inLiked).length,
    [catalogCache.songs, playbackSource],
  );

  useEffect(() => {
    void init();
    void catalogInit();
  }, [init, catalogInit]);

  useEffect(() => {
    if (loginInfo?.logged_in) void maybeAutoSync(playbackSource);
  }, [loginInfo?.logged_in, playbackSource, maybeAutoSync]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useMusicStore.setState({ toast: "" }), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void handleBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleBack]);

  return (
    <div className="app">
      <audio ref={bindAudio} preload="none" />
      {toast ? <div className="toast">{toast}</div> : null}
      {!authReady ? (
        <div className="boot-splash">
          <div className="boot-logo">NexMusic</div>
          <p>正在启动…</p>
        </div>
      ) : null}

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

      <MainScroll>
        {tab === "mine" ? (
        <>
        {!selectedPlaylist ? (
          !loginInfo?.logged_in ? (
            <>
              <div className="hero-login">
                <Heart color="#1ecd9a" size={42} />
                <h2>登录后查看收藏</h2>
                <p>只展示「我喜欢」和收藏的歌单</p>
                <button className="primary" onClick={() => void openLogin()}>
                  登录
                </button>
              </div>
              <LocalLibraryEntry />
              <RecentEntry />
            </>
          ) : loadingPlaylists ? (
            <p className="empty">正在加载歌单…</p>
          ) : playlistsError ? (
            <p className="empty">{playlistsError}</p>
          ) : (
            <>
              <LocalLibraryEntry />
              <RecentEntry />
              <div className="section-title">我的歌单</div>
              <LikedSyncBar />
              {playlists.length === 0 ? <p className="empty">还没有收藏歌单</p> : null}
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="playlist-row"
                  onClick={() => {
                      if (isLikedPlaylist(pl) && likedCount > 0) {
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
                      {isLikedPlaylist(pl) ? `${likedCount || pl.track_count} 首` : `${pl.track_count} 首`}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )
        ) : (
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
            {selectedPlaylist.id === "local" ? (
              <div className="catalog-actions">
                <button className="ghost" onClick={() => void importLocal()}>
                  导入歌曲
                </button>
              </div>
            ) : null}
            {loadingTracks ? (
              <p className="empty">加载歌曲…</p>
            ) : (
              <SongList
                songs={playlistTracks}
                playAll
                showPlayCount={isLikedPlaylist(selectedPlaylist) || selectedPlaylist.id === "local"}
                onRemove={selectedPlaylist.id === "local" ? (song) => removeLocal(song.id) : undefined}
              />
            )}
          </>
        )}
        </>
        ) : null}

        {tab === "settings" ? <SettingsTab /> : null}

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
      </MainScroll>

      <div
        className={currentSong ? "mini" : "mini mini-empty"}
        onClick={() => {
          if (currentSong) setNowPlayingOpen(true);
        }}
      >
        {currentSong ? (
          <img className="cover" src={coverProxyUrl(currentSong.cover, proxyPort)} alt="" />
        ) : (
          <div className="cover mini-cover-empty" />
        )}
        <div className="meta">
          <b>{currentSong?.name ?? "未在播放"}</b>
          <span>{currentSong?.artist ?? "点一首歌就会出现在这里"}</span>
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
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          <Settings size={18} />
          <div>设置</div>
        </button>
      </nav>

      <NowPlaying />
      <QueueSheet />
      <LoginSheet />
    </div>
  );
}
