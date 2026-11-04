import { resumeAt, type Video } from "../core/videos";
import { parseVideoId, watchUrl, YOUTUBE_TAB_PATTERNS } from "../core/youtube";

/** The pinned YouTube tab to use: the one in this window if there is one, otherwise any. */
async function findPinnedTab(windowId: number): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ pinned: true, url: YOUTUBE_TAB_PATTERNS });
  return tabs.find((tab) => tab.windowId === windowId) ?? tabs[0];
}

/** Plays the video in the pinned YouTube tab, and pins a new one if there isn't one. */
export async function openVideo(video: Video, windowId: number): Promise<void> {
  const url = watchUrl(video.id, resumeAt(video));
  const tab = await findPinnedTab(windowId);
  if (!tab?.id) {
    await chrome.tabs.create({ url, windowId, pinned: true, active: true });
    return;
  }
  // Already showing it: switch to it, rather than restart it.
  const showing = tab.url ? parseVideoId(tab.url) : null;
  await chrome.tabs.update(tab.id, showing === video.id ? { active: true } : { url, active: true });
  if (tab.windowId !== windowId) await chrome.windows.update(tab.windowId, { focused: true });
}
