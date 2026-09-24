import { addPluginListener, invoke, isTauri } from "@tauri-apps/api/core";

let bound = false;
let lastPosSync = 0;

export function bindMediaSessionControls(handlers: {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
}) {
  if (!isTauri() || bound) return;
  bound = true;
  void addPluginListener<{ action?: string }>("mediasession", "control", (ev) => {
    const action = ev?.action;
    if (action === "play") handlers.play();
    else if (action === "pause") handlers.pause();
    else if (action === "next") handlers.next();
    else if (action === "prev") handlers.prev();
  }).catch(() => {
    bound = false;
  });

  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => handlers.play());
    ms.setActionHandler("pause", () => handlers.pause());
    ms.setActionHandler("previoustrack", () => handlers.prev());
    ms.setActionHandler("nexttrack", () => handlers.next());
  }
}

export function syncMediaSession(opts: {
  title: string;
  artist: string;
  cover: string;
  playing: boolean;
  durationMs: number;
  positionMs: number;
}) {
  if (!isTauri()) return;
  void invoke("media_session_update", {
    title: opts.title,
    artist: opts.artist,
    cover: opts.cover,
    playing: opts.playing,
    durationMs: Math.max(0, Math.round(opts.durationMs)),
    positionMs: Math.max(0, Math.round(opts.positionMs)),
  }).catch(() => {});

  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: opts.title,
      artist: opts.artist,
      artwork: opts.cover ? [{ src: opts.cover, sizes: "512x512", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.playbackState = opts.playing ? "playing" : "paused";
  }
}

export function stopMediaSession() {
  if (!isTauri()) return;
  void invoke("media_session_stop").catch(() => {});
}

export function maybeSyncPosition(playing: boolean, durationMs: number, positionMs: number, song: { name: string; artist: string; cover: string } | null) {
  if (!playing || !song) return;
  const now = Date.now();
  if (now - lastPosSync < 5000) return;
  lastPosSync = now;
  syncMediaSession({
    title: song.name,
    artist: song.artist,
    cover: song.cover,
    playing,
    durationMs,
    positionMs,
  });
}
