import { isUnknownTag, type CatalogSong } from "@/types/catalog";
import type { Song } from "@/types/music";

export interface SimilarTags {
  language: string;
  artistGender: string;
  artists: string[];
  styles: string[];
}

const EMPTY_TAGS: SimilarTags = {
  language: "未知",
  artistGender: "未知",
  artists: [],
  styles: [],
};

function namesOf(song: { artist?: string; artists?: { name?: string }[] } | undefined): string[] {
  if (!song) return [];
  const names = new Set<string>();
  if (song.artist?.trim()) names.add(song.artist.trim());
  for (const artist of song.artists ?? []) {
    if (artist.name?.trim()) names.add(artist.name.trim());
  }
  return [...names];
}

export function tagsFromCatalog(song: CatalogSong | undefined, fallback?: Song): SimilarTags {
  const artists = namesOf(song);
  const tags: SimilarTags = song
    ? {
        language: song.language || "未知",
        artistGender: song.artistGender || "未知",
        artists,
        styles: song.styles ?? [],
      }
    : { ...EMPTY_TAGS, artists: [] };
  if (tags.artists.length === 0) tags.artists = namesOf(fallback);
  return tags;
}

export function hasUsableTags(tags: SimilarTags): boolean {
  return (
    tags.artists.length > 0 ||
    !isUnknownTag(tags.language) ||
    !isUnknownTag(tags.artistGender) ||
    tags.styles.length > 0
  );
}

function sameKnown(a: string, b: string): boolean {
  return !isUnknownTag(a) && !isUnknownTag(b) && a === b;
}

function sharesArtist(current: string[], candidate: string[]): boolean {
  if (current.length === 0 || candidate.length === 0) return false;
  const theirs = new Set(candidate);
  return current.some((name) => theirs.has(name));
}

function sharesStyle(current: string[], candidate: string[]): boolean {
  if (current.length === 0 || candidate.length === 0) return false;
  const theirs = new Set(candidate);
  return current.some((style) => theirs.has(style));
}

export function similarityScore(current: SimilarTags, candidate: SimilarTags): number {
  let score = 0;
  if (sharesArtist(current.artists, candidate.artists)) score += 4;
  if (sameKnown(current.artistGender, candidate.artistGender)) score += 4;
  if (sharesStyle(current.styles, candidate.styles)) score += 3;
  if (sameKnown(current.language, candidate.language)) score += 3;
  return score;
}

export function pickSimilarIndex(
  queue: Song[],
  currentIndex: number,
  catalog: CatalogSong[],
  recentKeys: ReadonlySet<string>,
  random: () => number = Math.random,
): number | null {
  if (queue.length < 2 || currentIndex < 0 || currentIndex >= queue.length) return null;
  const byKey = new Map(catalog.map((song) => [song.key, song]));
  const current = queue[currentIndex];
  const currentTags = tagsFromCatalog(byKey.get(`${current.provider}:${current.id}`), current);
  if (!hasUsableTags(currentTags)) return null;

  const weights: { index: number; weight: number }[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (i === currentIndex) continue;
    const song = queue[i];
    const tags = tagsFromCatalog(byKey.get(`${song.provider}:${song.id}`), song);
    let weight = 1 + similarityScore(currentTags, tags);
    const key = `${song.provider}:${song.id}`;
    if (recentKeys.has(key)) weight *= 0.2;
    weights.push({ index: i, weight });
  }
  if (weights.length === 0) return null;

  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return weights[0].index;
  let roll = random() * total;
  for (const item of weights) {
    roll -= item.weight;
    if (roll <= 0) return item.index;
  }
  return weights[weights.length - 1].index;
}
