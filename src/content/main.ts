// Runs on YouTube. Three jobs: say which video the save shortcut means, show
// toasts, and report playback of videos in the list.
import type { ContentMessage, TabMessage, TargetReply } from "../core/messages";
import { STORAGE_KEY, toWatch, type Video } from "../core/videos";
import { parseVideoId, thumbnailUrl } from "../core/youtube";

const REPORT_INTERVAL_MS = 5000;
const TOAST_MS = 3500;

/** Video IDs still to watch. Playback of anything else isn't reported. */
let listed = new Set<string>();
let hovered: string | null = null;
let lastReport = 0;

function setListed(videos: Video[] | undefined): void {
  const id = parseVideoId(location.href);
  const wasListed = id !== null && listed.has(id);
  listed = new Set(toWatch(videos ?? []).map((v) => v.id));
  // Just saved: the video may be paused, so there might not be another report for a while.
  if (id !== null && !wasListed && listed.has(id)) report({ force: true });
}

const playerVideo = () => document.querySelector<HTMLVideoElement>("#movie_player video, #shorts-player video");

const isAdPlaying = () => document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting") !== null;

/**
 * True while the player may still be on the previous video. YouTube moves
 * between videos without loading a page and reuses the same <video>: the URL
 * changes first, the player follows about a second later, and this attribute
 * follows the player. It isn't kept up to date on Shorts, and if it ever goes
 * away the length check in applyProgress still catches most of these.
 */
function isPlayerBehindUrl(id: string): boolean {
  if (location.pathname !== "/watch") return false;
  const loaded = document.querySelector("ytd-watch-flexy")?.getAttribute("video-id");
  return Boolean(loaded) && loaded !== id;
}

function report({ force = false, ended = false } = {}): void {
  // Gone once the extension has been reloaded. A new copy of this script takes over.
  if (!chrome.runtime?.id) return;
  const id = parseVideoId(location.href);
  const video = playerVideo();
  if (!id || !video || !listed.has(id) || isAdPlaying() || isPlayerBehindUrl(id)) return;
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  // The player sits at 0 until it's loaded, which would wipe a good position.
  if (video.currentTime < 1) return;
  const now = Date.now();
  if (!force && now - lastReport < REPORT_INTERVAL_MS) return;
  lastReport = now;
  const message: ContentMessage = {
    type: "progress",
    sample: { id, position: video.currentTime, duration: video.duration, ended },
  };
  chrome.runtime.sendMessage(message).catch(() => {});
}

let currentToast: HTMLElement | undefined;

/** A card in the corner of the page, showing which video it's about. */
function showToast(text: string, videoId?: string): void {
  currentToast?.remove();
  const host = document.createElement("div");
  host.dataset.youtubeLaterToast = "";
  const root = host.attachShadow({ mode: __E2E__ ? "open" : "closed" });
  const card = document.createElement("div");
  card.setAttribute("role", "status");
  card.style.cssText = `
    position: fixed; top: 72px; right: 24px; z-index: 2147483647;
    display: flex; align-items: center; gap: 12px; max-width: 340px; padding: 10px 16px 10px 10px;
    border-radius: 12px; background: #212121; color: #fff; pointer-events: none;
    font: 500 14px/20px Roboto, system-ui, sans-serif; box-shadow: 0 6px 24px rgb(0 0 0 / 45%);
  `;
  if (videoId) {
    const image = document.createElement("img");
    image.src = thumbnailUrl(videoId);
    image.alt = "";
    image.style.cssText = "flex: none; width: 96px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 6px;";
    card.append(image);
  }
  card.append(text);
  root.append(card);
  // Inside the fullscreen element, or it wouldn't show over fullscreen video.
  (document.fullscreenElement ?? document.body).append(host);
  currentToast = host;
  card.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], {
    duration: 150,
    easing: "ease-out",
  });
  setTimeout(() => host.remove(), TOAST_MS);
}

/** Media events don't bubble, so these are caught on the way down. */
function onMediaEvent(type: string, handler: () => void): void {
  document.addEventListener(type, (event) => {
    if (event.target === playerVideo()) handler();
  }, true);
}

onMediaEvent("timeupdate", () => report());
onMediaEvent("pause", () => report({ force: true }));
onMediaEvent("ended", () => report({ force: true, ended: true }));
window.addEventListener("pagehide", () => report({ force: true }));

document.addEventListener("mouseover", (event) => {
  const link = (event.target as Element).closest?.<HTMLAnchorElement>("a[href]");
  hovered = link ? parseVideoId(link.href) : null;
}, true);
document.documentElement.addEventListener("mouseleave", () => {
  hovered = null;
});

chrome.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
  if (message.type === "toast") {
    showToast(message.text, message.videoId);
  } else if (message.type === "get-target") {
    const reply: TargetReply = { id: hovered ?? parseVideoId(location.href) };
    sendResponse(reply);
  }
});

void chrome.storage.local.get(STORAGE_KEY).then((stored) => setListed(stored[STORAGE_KEY] as Video[] | undefined));
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[STORAGE_KEY];
  if (area === "local" && change) setListed(change.newValue as Video[] | undefined);
});
