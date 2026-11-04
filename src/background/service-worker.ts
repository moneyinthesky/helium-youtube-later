import { mergeBackup } from "../core/backup";
import type { ContentMessage, PanelMessage, TabMessage, TargetReply } from "../core/messages";
import {
  addVideo,
  applyProgress,
  markWatched,
  putBack,
  removeVideo,
  restoreVideo,
  STORAGE_KEY,
  type AddResult,
  type Video,
} from "../core/videos";
import { parseVideoId, YOUTUBE_TAB_PATTERNS } from "../core/youtube";
import { fillDetails, fillMissingDetails } from "./details";
import { openVideo } from "./open-video";
import { loadVideos, updateBadge, updateVideos } from "./store";

const SAVE_LINK_MENU = "save-link";
const SAVE_PAGE_MENU = "save-page";

const TOAST_TEXT: Record<AddResult, string> = {
  added: "Saved to YouTube Later",
  exists: "Already in YouTube Later",
  restored: "Back in YouTube Later",
};

const VIDEO_URL_PATTERNS = [
  "*://*.youtube.com/watch*",
  "*://*.youtube.com/shorts/*",
  "*://*.youtube.com/live/*",
  "*://youtu.be/*",
];

/** Shown on the page if it's YouTube. Other pages have no content script, and the badge has to do. */
function toast(tabId: number | undefined, text: string, videoId?: string): void {
  if (tabId === undefined) return;
  const message: TabMessage = { type: "toast", text, videoId };
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

/**
 * Installing or updating cuts off the script in every open YouTube tab, and
 * browsers only add it to pages as they load. Without this, those tabs would
 * save videos but show no confirmation and report no progress until refreshed.
 */
async function connectOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TAB_PATTERNS });
  await Promise.all(
    tabs.map(({ id }) =>
      id === undefined
        ? undefined
        : // Fails for tabs the browser has put to sleep, which get the script when they wake.
          chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }).catch(() => {}),
    ),
  );
}

async function saveVideo(id: string, tabId: number | undefined): Promise<void> {
  const now = Date.now();
  const result = await updateVideos<AddResult>((videos) => addVideo(videos, id, now));
  toast(tabId, TOAST_TEXT[result], id);
  if (result === "added") await fillDetails(id);
}

/** The save shortcut: the thumbnail under the pointer if there is one, otherwise the video playing. */
async function saveFromTab(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (tab?.id === undefined) return;
  const request: TabMessage = { type: "get-target" };
  const reply = (await chrome.tabs.sendMessage(tab.id, request).catch(() => undefined)) as TargetReply | undefined;
  // No reply from a tab that was open before the extension was installed or reloaded.
  const id = reply?.id ?? (tab.url ? parseVideoId(tab.url) : null);
  if (id) await saveVideo(id, tab.id);
  else toast(tab.id, "Point at a thumbnail, or open a video, to save it");
}

async function onCommand(command: string, tab?: chrome.tabs.Tab): Promise<void> {
  if (command === "save-video") await saveFromTab(tab);
}

async function onContextMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  const url = info.menuItemId === SAVE_LINK_MENU ? info.linkUrl : info.pageUrl;
  const id = url ? parseVideoId(url) : null;
  if (id) await saveVideo(id, tab?.id);
}

async function onPanelMessage(message: PanelMessage): Promise<void> {
  const now = Date.now();
  switch (message.type) {
    case "open": {
      const video = (await loadVideos()).find((v) => v.id === message.id);
      if (video) await openVideo(video, message.windowId);
      return;
    }
    case "remove":
      return updateVideos((videos) => ({ videos: removeVideo(videos, message.id) }));
    case "mark-watched":
      return updateVideos((videos) => ({ videos: markWatched(videos, message.id, now) }));
    case "put-back":
      return updateVideos((videos) => ({ videos: putBack(videos, message.id) }));
    case "restore":
      return updateVideos((videos) => ({ videos: restoreVideo(videos, message.video, message.index) }));
    case "import":
      return updateVideos((videos) => ({ videos: mergeBackup(videos, message.videos) }));
    case "refresh-details":
      return fillMissingDetails(await loadVideos());
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Not after a browser update: tabs are already connected then, and would end up with two scripts.
  if (reason === "install" || reason === "update") void connectOpenTabs();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SAVE_LINK_MENU,
      title: "Save video to YouTube Later",
      contexts: ["link"],
      targetUrlPatterns: VIDEO_URL_PATTERNS,
    });
    chrome.contextMenus.create({
      id: SAVE_PAGE_MENU,
      title: "Save this video to YouTube Later",
      contexts: ["page"],
      documentUrlPatterns: VIDEO_URL_PATTERNS,
    });
  });
  void updateBadge();
});

chrome.runtime.onStartup.addListener(() => void updateBadge());

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[STORAGE_KEY];
  if (area === "local" && change) void updateBadge((change.newValue as Video[] | undefined) ?? []);
});

chrome.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));
chrome.contextMenus.onClicked.addListener((info, tab) => void onContextMenu(info, tab));

chrome.runtime.onMessage.addListener((message: PanelMessage | ContentMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  // Pages only ever report progress. Everything else has to come from the panel.
  if (message.type === "progress") {
    const { sample } = message;
    const now = Date.now();
    void updateVideos((videos) => ({ videos: applyProgress(videos, sample, now) }));
    return;
  }
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  onPanelMessage(message).finally(() => sendResponse());
  return true; // sendResponse comes later
});

if (__E2E__) {
  // Real key presses and context menus can't be automated.
  Object.assign(globalThis, { __test: { onCommand, onContextMenu, connectOpenTabs } });
}
