// The list itself: pure functions from one list to the next, so they can be
// tested without a browser. New videos go first.

/** Where the list lives in chrome.storage.local. */
export const STORAGE_KEY = "videos";

export interface Video {
  id: string;
  /** Empty until the details have been fetched. */
  title: string;
  channel: string;
  addedAt: number;
  /** Seconds. Missing for live streams, or until it's known. */
  duration?: number;
  /** Seconds watched so far. */
  position?: number;
  /** Set once it's in the Watched section. */
  watchedAt?: number;
  /** When YouTube was last asked how far you'd got. */
  checkedAt?: number;
  /**
   * Set when a video joins the list. Being near the end doesn't finish it until
   * the player has been somewhere earlier, so that saving a video near its end,
   * or pressing Undo there, doesn't send it straight to Watched. Reaching the
   * very end still does.
   */
  finishHeld?: boolean;
}

export interface ProgressSample {
  id: string;
  position: number;
  duration: number;
  ended: boolean;
}

export type AddResult = "added" | "exists" | "restored";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long videos stay in the Watched section. */
export const WATCHED_RETENTION_MS = 30 * DAY_MS;

/** Played durations further than this from the known length belong to something else: an ad, or the last video. */
const DURATION_TOLERANCE_SECONDS = 5;

/** How often to ask YouTube about a video you haven't played since saving it. */
const RECHECK_MS = DAY_MS;

/** Don't bother resuming from before this point. */
const MIN_RESUME_SECONDS = 10;

/** Resume a little before where you stopped, to pick the thread back up. */
const RESUME_REWIND_SECONDS = 3;

export const toWatch = (videos: Video[]) => videos.filter((v) => v.watchedAt === undefined);

export const watched = (videos: Video[]) =>
  videos.filter((v) => v.watchedAt !== undefined).sort((a, b) => (b.watchedAt ?? 0) - (a.watchedAt ?? 0));

export function addVideo(videos: Video[], id: string, now: number): { videos: Video[]; result: AddResult } {
  const existing = videos.find((v) => v.id === id);
  if (existing && existing.watchedAt === undefined) return { videos, result: "exists" };
  const { watchedAt: _, position: __, ...kept } = existing ?? { id, title: "", channel: "" };
  const video: Video = { ...kept, addedAt: now, finishHeld: true };
  return { videos: [video, ...videos.filter((v) => v.id !== id)], result: existing ? "restored" : "added" };
}

export const removeVideo = (videos: Video[], id: string) => videos.filter((v) => v.id !== id);

/** Undo: replaces the video if it's still there, otherwise puts it back at `index`. */
export function restoreVideo(videos: Video[], restored: Video, index: number): Video[] {
  const video: Video = { ...restored, finishHeld: true };
  if (videos.some((v) => v.id === video.id)) return videos.map((v) => (v.id === video.id ? video : v));
  return [...videos.slice(0, index), video, ...videos.slice(index)];
}

const updateVideo = (videos: Video[], id: string, change: (video: Video) => Video) =>
  videos.map((v) => (v.id === id ? change(v) : v));

export const markWatched = (videos: Video[], id: string, now: number) =>
  updateVideo(videos, id, ({ position: _, finishHeld: __, ...video }) => ({ ...video, watchedAt: now }));

export const putBack = (videos: Video[], id: string) =>
  updateVideo(videos, id, ({ watchedAt: _, position: __, ...video }) => ({ ...video, finishHeld: true }));

/** Progress seen here wins over what YouTube says, as it's at least as recent. */
export const applyMetadata = (
  videos: Video[],
  id: string,
  details: Partial<Pick<Video, "title" | "channel" | "duration" | "position" | "checkedAt">>,
) =>
  updateVideo(videos, id, (video) => {
    const position = video.watchedAt === undefined ? (video.position ?? details.position) : undefined;
    return {
      ...video,
      title: details.title ?? video.title,
      channel: details.channel ?? video.channel,
      duration: details.duration ?? video.duration,
      checkedAt: details.checkedAt ?? video.checkedAt,
      ...(position === undefined ? {} : { position }),
    };
  });

/** Details are missing, or you might have started it somewhere this extension couldn't see. */
export function needsDetails(video: Video, now: number): boolean {
  if (!video.title) return true;
  if (video.watchedAt !== undefined || video.position !== undefined) return false;
  return now - (video.checkedAt ?? 0) >= RECHECK_MS;
}

/**
 * Counted as finished at 90%, but never more than two minutes from the end, so
 * that a three-hour video isn't finished with 18 minutes to go. End screens and
 * credits mean many people never reach the very end.
 */
export const isFinished = (position: number, duration: number) =>
  duration - position <= Math.min(duration * 0.1, 120);

export function applyProgress(videos: Video[], sample: ProgressSample, now: number): Video[] {
  const { id, position, duration, ended } = sample;
  const video = videos.find((v) => v.id === id);
  if (!video || video.watchedAt !== undefined) return videos;
  if (!Number.isFinite(duration) || duration <= 0) return videos;
  if (video.duration !== undefined && Math.abs(video.duration - duration) > DURATION_TOLERANCE_SECONDS) return videos;
  const nearEnd = isFinished(position, duration);
  if (ended || (nearEnd && !video.finishHeld)) return markWatched(videos, id, now);
  return updateVideo(videos, id, ({ finishHeld: _, ...v }) => ({
    ...v,
    position,
    duration: v.duration ?? duration,
    ...(nearEnd ? { finishHeld: true } : {}),
  }));
}

export const pruneWatched = (videos: Video[], now: number) =>
  videos.filter((v) => v.watchedAt === undefined || now - v.watchedAt < WATCHED_RETENTION_MS);

/** Where to start playing, in whole seconds. */
export function resumeAt(video: Video): number {
  const position = video.position ?? 0;
  if (video.watchedAt !== undefined || position < MIN_RESUME_SECONDS) return 0;
  return Math.floor(position) - RESUME_REWIND_SECONDS;
}

/** Share of the video watched, from 0 to 1. */
export function progressOf(video: Video): number {
  if (!video.duration || !video.position) return 0;
  return Math.min(video.position / video.duration, 1);
}
