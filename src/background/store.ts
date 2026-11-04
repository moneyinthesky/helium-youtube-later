// The service worker is the only writer. Writes run one at a time, so a progress
// update can't overwrite a save that happened while it was reading the list.
import { pruneWatched, STORAGE_KEY, toWatch, type Video } from "../core/videos";

export async function loadVideos(): Promise<Video[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as Video[] | undefined) ?? [];
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs `change` on the latest list and saves what it returns. */
export function updateVideos<T = void>(change: (videos: Video[]) => { videos: Video[]; result?: T }): Promise<T> {
  const run = queue.then(async () => {
    const before = await loadVideos();
    const { videos, result } = change(before);
    const after = pruneWatched(videos, Date.now());
    // Unchanged lists aren't written: most progress reports are for nothing in the list's state.
    if (videos !== before || after.length !== before.length) await chrome.storage.local.set({ [STORAGE_KEY]: after });
    return result as T;
  });
  queue = run.catch(() => {});
  return run;
}

/** The toolbar icon's badge counts what's left to watch. */
export async function updateBadge(videos?: Video[]): Promise<void> {
  const count = toWatch(videos ?? (await loadVideos())).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#cc0000" });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}
