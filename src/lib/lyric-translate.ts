import { invoke, isTauri } from "@tauri-apps/api/core";
import { buildKaraokeLines } from "@/lib/karaoke-lyrics";
import { catalogKey } from "@/types/catalog";
import type { Lyrics, Song } from "@/types/music";

const CACHE_KEY = "nexmusic-lyric-trans";
const CACHE_LIMIT = 200;

function cjkRatio(text: string): number {
  const chars = [...text.replace(/\s+/g, "")];
  if (chars.length === 0) return 1;
  let cjk = 0;
  for (const ch of chars) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
  }
  return cjk / chars.length;
}

function formatStamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function loadCache(key: string): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed[key] || null;
  } catch {
    return null;
  }
}

function saveCache(key: string, translation: string) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    parsed[key] = translation;
    const keys = Object.keys(parsed);
    if (keys.length > CACHE_LIMIT) {
      for (const old of keys.slice(0, keys.length - CACHE_LIMIT)) delete parsed[old];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
  } catch {
    /* quota */
  }
}

async function translateLines(lines: string[]): Promise<string[] | null> {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 80) {
    const chunk = lines.slice(i, i + 80);
    try {
      const translated = await invoke<string[]>("catalog_translate_lyric", { lines: chunk });
      if (!Array.isArray(translated) || translated.length !== chunk.length) return null;
      out.push(...translated);
    } catch {
      return null;
    }
  }
  return out;
}

/** 已有译文时不处理。需要补译时返回带 translation 的歌词，否则返回 null。 */
export async function maybeFillTranslation(song: Song, lyrics: Lyrics): Promise<Lyrics | null> {
  if (lyrics.translation?.trim()) return null;
  if (song.provider === "local") return null;
  const rows = buildKaraokeLines(lyrics);
  if (rows.length === 0 || rows.every((row) => !row.text.trim())) return null;

  const key = catalogKey(song.provider as "qqmusic" | "netease" | "kugou", song.id);
  const cached = loadCache(key);
  if (cached) return { ...lyrics, translation: cached };

  const { useCatalogStore } = await import("@/stores/catalog-store");
  const tagged = useCatalogStore.getState().cache.songs.find((item) => item.key === key);
  const language = tagged?.language || "未知";
  if (language === "华语") return null;
  if (language === "未知" && cjkRatio(rows.map((row) => row.text).join("")) >= 0.3) return null;
  if (!isTauri()) return null;
  const hasKey = await invoke<boolean>("catalog_has_deepseek_key").catch(() => false);
  if (!hasKey) return null;

  const translated = await translateLines(rows.map((row) => row.text.trim()));
  if (!translated) return null;
  const translation = rows
    .map((row, i) => `[${formatStamp(row.time)}]${translated[i] ?? ""}`)
    .join("\n");
  saveCache(key, translation);
  return { ...lyrics, translation };
}
