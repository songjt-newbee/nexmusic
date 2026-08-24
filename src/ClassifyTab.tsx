import { useMemo, useRef, useState, type ReactNode } from "react";
import { Download, ListPlus, Pencil, Plus, RefreshCw, Upload } from "lucide-react";
import { coverProxyUrl, useMusicStore } from "@/stores/music-store";
import { formatSyncedAt, useCatalogStore } from "@/stores/catalog-store";
import { filterCatalog } from "@/lib/catalog";
import {
  COUNTRIES,
  LANGUAGES,
  MUSIC_TYPES,
  STYLE_PRESETS,
  catalogToSong,
  type CatalogSong,
} from "@/types/catalog";

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "chip active" : "chip"} onClick={onClick}>
      {children}
    </button>
  );
}

export function LikedSyncBar() {
  const playbackSource = useMusicStore((s) => s.playbackSource);
  const loginInfo = useMusicStore((s) => s.loginInfo);
  const cache = useCatalogStore((s) => s.cache);
  const syncing = useCatalogStore((s) => s.syncing);
  const syncCurrent = useCatalogStore((s) => s.syncCurrent);
  const syncMessage = useCatalogStore((s) => s.syncMessage);
  const syncLiked = useCatalogStore((s) => s.syncLiked);
  const count = cache.songs.filter((s) => s.sources.includes(playbackSource) && s.inLiked).length;
  const synced = formatSyncedAt(cache.syncedAt[playbackSource]);

  return (
    <div className="catalog-sync">
      <div className="catalog-sync-meta">
        <b>{count} 首本机缓存</b>
        <span>{syncing ? syncMessage || `已拉取 ${syncCurrent} 首…` : `上次同步：${synced}`}</span>
      </div>
      <button
        className="ghost"
        disabled={syncing || !loginInfo?.logged_in}
        onClick={() => void syncLiked(playbackSource)}
      >
        <RefreshCw size={14} />
        {syncing ? "同步中" : "同步我喜欢"}
      </button>
    </div>
  );
}

function TagEditor({ song, onClose }: { song: CatalogSong; onClose: () => void }) {
  const updateSongTags = useCatalogStore((s) => s.updateSongTags);
  const [language, setLanguage] = useState(song.language || "未知");
  const [artistCountry, setArtistCountry] = useState(song.artistCountry || "未知");
  const [musicType, setMusicType] = useState(song.musicType || "未知");
  const [styles, setStyles] = useState<string[]>(song.styles || []);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px" }}>{song.name}</h3>
        <p className="muted-line">{song.artist}</p>
        <label className="field-label">语言</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <label className="field-label">歌手国家</label>
        <select value={artistCountry} onChange={(e) => setArtistCountry(e.target.value)}>
          {COUNTRIES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <label className="field-label">类型</label>
        <select value={musicType} onChange={(e) => setMusicType(e.target.value)}>
          {MUSIC_TYPES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <label className="field-label">风格</label>
        <div className="chip-row">
          {STYLE_PRESETS.map((st) => (
            <Chip
              key={st}
              active={styles.includes(st)}
              onClick={() =>
                setStyles((prev) => (prev.includes(st) ? prev.filter((x) => x !== st) : [...prev, st]))
              }
            >
              {st}
            </Chip>
          ))}
        </div>
        <button
          className="primary"
          style={{ width: "100%", marginTop: 14 }}
          onClick={() => void updateSongTags(song.key, { language, artistCountry, musicType, styles })}
        >
          保存标签
        </button>
      </div>
    </div>
  );
}

export function ClassifyTab() {
  const playbackSource = useMusicStore((s) => s.playbackSource);
  const playSong = useMusicStore((s) => s.playSong);
  const addToQueue = useMusicStore((s) => s.addToQueue);
  const addListToQueue = useMusicStore((s) => s.addListToQueue);
  const proxyPort = useMusicStore((s) => s.proxyPort);
  const cache = useCatalogStore((s) => s.cache);
  const filters = useCatalogStore((s) => s.filters);
  const setFilters = useCatalogStore((s) => s.setFilters);
  const editingKey = useCatalogStore((s) => s.editingKey);
  const setEditingKey = useCatalogStore((s) => s.setEditingKey);
  const exportJson = useCatalogStore((s) => s.exportJson);
  const importJson = useCatalogStore((s) => s.importJson);
  const guessTags = useCatalogStore((s) => s.guessTags);
  const deepseekTag = useCatalogStore((s) => s.deepseekTag);
  const saveDeepseekKey = useCatalogStore((s) => s.saveDeepseekKey);
  const hasDeepseekKey = useCatalogStore((s) => s.hasDeepseekKey);
  const tagging = useCatalogStore((s) => s.tagging);
  const tagCurrent = useCatalogStore((s) => s.tagCurrent);
  const tagTotal = useCatalogStore((s) => s.tagTotal);
  const fileRef = useRef<HTMLInputElement>(null);
  const [keyDraft, setKeyDraft] = useState("");

  const songs = useMemo(() => filterCatalog(cache.songs, filters), [cache.songs, filters]);
  const playable = useMemo(() => songs.map(catalogToSong), [songs]);
  const editing = cache.songs.find((s) => s.key === editingKey) ?? null;

  const toggleStyle = (st: string) => {
    const next = filters.styles.includes(st)
      ? filters.styles.filter((s) => s !== st)
      : [...filters.styles, st];
    setFilters({ styles: next });
  };

  return (
    <>
      <LikedSyncBar />
      <div className="catalog-actions">
        <button className="ghost" onClick={() => exportJson()}>
          <Download size={14} /> 导出
        </button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> 导入
        </button>
        <button className="ghost" onClick={() => void guessTags()}>
          规则猜测
        </button>
        <button className="ghost" disabled={tagging} onClick={() => void deepseekTag()}>
          {tagging ? `AI ${tagCurrent}/${tagTotal}` : "AI 标注"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void file.text().then((text) => importJson(text));
        }}
      />
      <div className="key-row">
        <input
          type="password"
          placeholder={hasDeepseekKey ? "已保存 DeepSeek Key，可覆盖" : "DeepSeek API Key"}
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
        />
        <button className="ghost" onClick={() => void saveDeepseekKey(keyDraft).then(() => setKeyDraft(""))}>
          保存
        </button>
      </div>

      <div className="section-title">筛选（同时满足）</div>
      <div className="chip-row">
        <Chip active={filters.language === "全部"} onClick={() => setFilters({ language: "全部" })}>
          语言·全部
        </Chip>
        {LANGUAGES.filter((v) => v !== "未知").map((v) => (
          <Chip key={v} active={filters.language === v} onClick={() => setFilters({ language: v })}>
            {v}
          </Chip>
        ))}
      </div>
      <div className="chip-row">
        <Chip active={filters.artistCountry === "全部"} onClick={() => setFilters({ artistCountry: "全部" })}>
          国家·全部
        </Chip>
        {COUNTRIES.filter((v) => v !== "未知").map((v) => (
          <Chip key={v} active={filters.artistCountry === v} onClick={() => setFilters({ artistCountry: v })}>
            {v}
          </Chip>
        ))}
      </div>
      <div className="chip-row">
        <Chip active={filters.musicType === "全部"} onClick={() => setFilters({ musicType: "全部" })}>
          类型·全部
        </Chip>
        {MUSIC_TYPES.filter((v) => v !== "未知").map((v) => (
          <Chip key={v} active={filters.musicType === v} onClick={() => setFilters({ musicType: v })}>
            {v}
          </Chip>
        ))}
      </div>
      <div className="chip-row">
        {STYLE_PRESETS.map((st) => (
          <Chip key={st} active={filters.styles.includes(st)} onClick={() => toggleStyle(st)}>
            {st}
          </Chip>
        ))}
      </div>
      <label className="check-line">
        <input
          type="checkbox"
          checked={filters.hideUnliked}
          onChange={(e) => setFilters({ hideUnliked: e.target.checked })}
        />
        隐藏已取消喜欢
      </label>

      <div className="section-title">
        {songs.length} 首
        {playable.length > 0 ? (
          <button
            className="icon-btn"
            title="将筛选结果加入播放列表"
            onClick={() => addListToQueue(playable)}
          >
            <ListPlus size={18} />
          </button>
        ) : null}
      </div>
      {songs.length === 0 ? (
        <p className="empty">还没有可筛选的歌曲，请先登录并同步我喜欢</p>
      ) : (
        songs.map((song) => {
          const item = catalogToSong(song);
          return (
            <div key={song.key} className="song-row">
              <img
                className="cover"
                src={coverProxyUrl(song.cover, proxyPort)}
                alt=""
                onClick={() => void playSong(item)}
              />
              <div className="meta" onClick={() => void playSong(item)}>
                <b>{song.name}</b>
                <span>{song.artist}</span>
                <span className="tag-line">
                  {[song.language, song.artistCountry, song.musicType, ...song.styles]
                    .filter((v) => v && v !== "未知")
                    .join(" · ") || "未分类"}
                  {song.sources[0] === playbackSource ? "" : ` · ${song.sources[0]}`}
                  {song.inLiked ? "" : " · 已不在喜欢"}
                </span>
              </div>
              <button
                className="icon-btn"
                title="加入播放列表"
                onClick={(e) => {
                  e.stopPropagation();
                  addToQueue([item]);
                }}
              >
                <Plus size={16} />
              </button>
              <button
                className="icon-btn"
                title="改标签"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingKey(song.key);
                }}
              >
                <Pencil size={16} />
              </button>
            </div>
          );
        })
      )}
      {editing ? <TagEditor song={editing} onClose={() => setEditingKey(null)} /> : null}
    </>
  );
}
