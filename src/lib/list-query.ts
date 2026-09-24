import type { CatalogSong } from "@/types/catalog";
import type { Song } from "@/types/music";

function compact(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toLowerCase();
}

function songFields(song: Song, catalog?: CatalogSong): string[] {
  const fields = [song.name, song.artist, song.album, ...(song.artists ?? []).map((artist) => artist.name)];
  if (catalog) {
    fields.push(
      catalog.language,
      catalog.artistCountry,
      catalog.artistGender,
      catalog.musicType,
      ...(catalog.styles ?? []),
    );
  }
  return fields;
}

export function matchesListQuery(song: Song, query: string, catalog?: CatalogSong): boolean {
  const q = compact(query);
  if (!q) return true;
  return songFields(song, catalog).some((value) => value && compact(value).includes(q));
}

function matchesNameOrArtist(song: Song, query: string): boolean {
  const q = compact(query);
  if (!q) return false;
  const fields = [song.name, song.artist, ...(song.artists ?? []).map((artist) => artist.name)];
  return fields.some((value) => value && compact(value).includes(q));
}

export function preferLibraryMatches(query: string, mine: Song[], online: Song[]): Song[] {
  const hits: Song[] = [];
  const seen = new Set<string>();
  for (const song of mine) {
    const key = `${song.provider}:${song.id}`;
    if (seen.has(key) || !matchesNameOrArtist(song, query)) continue;
    seen.add(key);
    hits.push(song);
  }
  const rest = online.filter((song) => !seen.has(`${song.provider}:${song.id}`));
  return [...hits, ...rest];
}
