// Export and import. A backup is a file from outside, so nothing in it is trusted.
import { isVideoId } from "./youtube";
import type { Video } from "./videos";

const APP = "youtube-later";

export const toBackup = (videos: Video[]) => JSON.stringify({ app: APP, version: 1, videos }, null, 2);

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function parseVideo(value: unknown): Video | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, title, channel, addedAt, duration, position, watchedAt } = value as Record<string, unknown>;
  if (!isVideoId(id) || typeof title !== "string" || typeof channel !== "string" || !isTime(addedAt)) return null;
  return {
    id,
    title,
    channel,
    addedAt,
    ...(isTime(duration) ? { duration } : {}),
    ...(isTime(position) ? { position } : {}),
    ...(isTime(watchedAt) ? { watchedAt } : {}),
  };
}

/** The videos in a backup file, leaving out any malformed ones. Null if it isn't a backup at all. */
export function parseBackup(text: string): Video[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const { app, videos } = (data ?? {}) as { app?: unknown; videos?: unknown };
  if (app !== APP || !Array.isArray(videos)) return null;
  return videos.map(parseVideo).filter((video) => video !== null);
}

/** Adds what the list doesn't have. Videos already in the list stay as they are. */
export function mergeBackup(videos: Video[], incoming: Video[]): Video[] {
  const known = new Set(videos.map((v) => v.id));
  const added = incoming.filter((v) => {
    if (known.has(v.id)) return false;
    known.add(v.id);
    return true;
  });
  return [...videos, ...added];
}
