import { parseBackup, toBackup } from "../core/backup";
import { formatDuration } from "../core/format";
import type { PanelMessage } from "../core/messages";
import { progressOf, STORAGE_KEY, toWatch, watched, type Video } from "../core/videos";
import { parseVideoId, thumbnailUrl, YOUTUBE_TAB_PATTERNS } from "../core/youtube";

const SNACKBAR_MS = 6000;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const toWatchList = element("to-watch");
const watchedList = element("watched");
const watchedSection = element("watched-section");
const keys = element("keys");
const count = element("count");
const watchedCount = element("watched-count");
const empty = element("empty");
const importFile = element<HTMLInputElement>("import-file");
const snackbar = element("snackbar");
const snackbarText = element("snackbar-text");
const snackbarUndo = element("snackbar-undo");

/** The list as last drawn. */
let current: Video[] = [];
let windowId: number = chrome.windows.WINDOW_ID_CURRENT;

const send = (message: PanelMessage) => chrome.runtime.sendMessage(message);

/** How to put a video back as it was. */
interface Undo {
  video: Video;
  index: number;
}

/** Outlives the snackbar, so ⌘Z still works after it's gone. */
let pendingUndo: Undo | undefined;

/** The video to select once it's back in the list. */
let selectAfterDraw: string | undefined;

let snackbarTimer: ReturnType<typeof setTimeout> | undefined;

function showSnackbar(text: string, undo?: Undo): void {
  clearTimeout(snackbarTimer);
  pendingUndo = undo;
  snackbarText.textContent = text;
  snackbarUndo.hidden = !undo;
  snackbar.hidden = false;
  snackbarTimer = setTimeout(() => (snackbar.hidden = true), SNACKBAR_MS);
}

function undoLast(): void {
  if (!pendingUndo) return;
  const { video, index } = pendingUndo;
  pendingUndo = undefined;
  snackbar.hidden = true;
  selectAfterDraw = video.id;
  void send({ type: "restore", video, index });
}

snackbarUndo.addEventListener("click", undoLast);

/** Plays the video, then gets out of the way unless asked not to. */
async function play(id: string, keepOpen: boolean): Promise<void> {
  await send({ type: "open", id, windowId });
  if (!keepOpen) window.close();
}

const displayTitle = (video: Video) => video.title || "YouTube video";

/** Takes the video off the list, and offers to put it back as it was. */
function removeWithUndo(video: Video): void {
  const index = current.findIndex((v) => v.id === video.id);
  void send({ type: "remove", id: video.id });
  showSnackbar(`Removed ${displayTitle(video)}`, { video, index });
}

function actionButton(label: string, symbol: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = symbol;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

interface Row {
  root: HTMLLIElement;
  open: HTMLButtonElement;
  update(video: Video): void;
  remove(): void;
  toggleWatched(): void;
}

/** Rows are kept between draws, so progress updates don't reload thumbnails or lose keyboard focus. */
const rows = new Map<string, Row>();

function createRow(id: string): Row {
  let video: Video;

  const root = document.createElement("li");
  root.className = "video";
  root.dataset.id = id;
  root.innerHTML = `
    <button class="open" type="button">
      <span class="thumb">
        <img alt="" />
        <span class="time"></span>
        <span class="bar"><i></i></span>
      </span>
      <span class="details">
        <span class="title"></span>
        <span class="channel"></span>
      </span>
    </button>
    <div class="actions"></div>
  `;

  const part = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const image = part<HTMLImageElement>("img");
  const time = part<HTMLElement>(".time");
  const bar = part<HTMLElement>(".bar");
  const fill = part<HTMLElement>(".bar i");
  const title = part<HTMLElement>(".title");
  const channel = part<HTMLElement>(".channel");
  const open = part<HTMLButtonElement>(".open");
  const actions = part<HTMLElement>(".actions");

  image.addEventListener("error", () => image.classList.add("broken"));
  image.src = thumbnailUrl(id);
  open.addEventListener("click", (event) => void play(id, event.metaKey || event.ctrlKey));

  const markWatched = actionButton("Mark as watched", "✓", () => void send({ type: "mark-watched", id }));
  const putBack = actionButton("Put back in To watch", "↩", () => void send({ type: "put-back", id }));
  const remove = actionButton("Remove", "✕", () => removeWithUndo(video));

  return {
    root,
    open,
    remove: () => removeWithUndo(video),
    toggleWatched: () => void send({ type: video.watchedAt === undefined ? "mark-watched" : "put-back", id }),
    update(next) {
      video = next;
      title.textContent = displayTitle(next);
      channel.textContent = next.channel;
      open.title = displayTitle(next);
      time.textContent = next.duration ? formatDuration(next.duration) : "";
      time.hidden = !next.duration;
      const progress = progressOf(next);
      bar.hidden = progress === 0;
      fill.style.width = `${progress * 100}%`;
      actions.replaceChildren(next.watchedAt === undefined ? markWatched : putBack, remove);
    },
  };
}

function drawList(list: HTMLElement, videos: Video[]): void {
  const wanted = videos.map((video) => {
    const row = rows.get(video.id) ?? createRow(video.id);
    rows.set(video.id, row);
    row.update(video);
    return row.root;
  });
  // Only touched when the order changes. Moving an element drops its focus, which settleSelection puts back.
  const same = wanted.length === list.children.length && wanted.every((row, i) => row === list.children[i]);
  if (!same) list.replaceChildren(...wanted);
}

/** Everything the arrow keys can land on, top to bottom. */
const navigable = () =>
  [...document.querySelectorAll<HTMLElement>(".open, #watched-section:not([hidden]) summary")].filter(
    (item) => !item.closest("details:not([open]) .videos"),
  );

function select(item: HTMLElement | undefined): void {
  item?.focus();
  item?.scrollIntoView({ block: "nearest" });
}

/**
 * Keeps the selection sensible after the list changes. If the selected video
 * left its section, the selection moves to the one that took its place, so
 * several can be removed in a row.
 */
function settleSelection(before: HTMLElement[], selected: Element | null, section: Element | null | undefined): void {
  const restored = selectAfterDraw ? rows.get(selectAfterDraw) : undefined;
  if (restored) {
    selectAfterDraw = undefined;
    select(restored.open);
    return;
  }
  const index = before.indexOf(selected as HTMLElement);
  if (index === -1) return;
  const item = before[index];
  if (item?.isConnected && item.closest("ul") === section) {
    if (document.activeElement !== item) item.focus();
    return;
  }
  const after = navigable();
  const neighbours = [...before.slice(index + 1), ...before.slice(0, index).reverse()];
  select(neighbours.find((neighbour) => after.includes(neighbour)));
}

function draw(videos: Video[]): void {
  const before = navigable();
  const selected = document.activeElement;
  const section = selected?.closest("ul");
  const pending = toWatch(videos);
  const done = watched(videos);
  const ids = new Set(videos.map((v) => v.id));
  for (const id of rows.keys()) {
    if (!ids.has(id)) {
      rows.get(id)?.root.remove();
      rows.delete(id);
    }
  }
  drawList(toWatchList, pending);
  drawList(watchedList, done);
  count.textContent = pending.length > 0 ? String(pending.length) : "";
  watchedCount.textContent = String(done.length);
  watchedSection.hidden = done.length === 0;
  empty.hidden = pending.length > 0;
  keys.hidden = videos.length === 0;
  settleSelection(before, selected, section);
}

/** A video that's just finished, on its own or by hand, can be put straight back. */
function announceFinished(before: Video[], after: Video[]): void {
  const finished = after.find(
    (v) => v.watchedAt !== undefined && before.some((old) => old.id === v.id && old.watchedAt === undefined),
  );
  const previous = before.find((v) => v.id === finished?.id);
  if (!finished || !previous) return;
  const index = before.indexOf(previous);
  showSnackbar(`Watched ${displayTitle(finished)}`, { video: previous, index });
}

async function showEmptyHint(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === "save-video")?.shortcut;
  empty.replaceChildren("Nothing to watch yet. Right-click a video link");
  if (shortcut) {
    const key = document.createElement("kbd");
    key.textContent = shortcut;
    empty.append(", or press ", key, " on a video or while pointing at a thumbnail");
  }
  empty.append(", to save it here.");
}

function exportList(): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([toBackup(current)], { type: "application/json" }));
  link.download = `youtube-later-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importList(file: File): Promise<void> {
  const videos = parseBackup(await file.text());
  if (!videos) {
    showSnackbar("That isn't a YouTube Later export");
    return;
  }
  const known = new Set(current.map((v) => v.id));
  const added = videos.filter((v) => !known.has(v.id)).length;
  await send({ type: "import", videos });
  showSnackbar(`Imported ${added} ${added === 1 ? "video" : "videos"}`);
}

/** The video you're watching, if it's on show in the list: in the tab you're on, or failing that the pinned one. */
async function rowBeingWatched(): Promise<Row | undefined> {
  const tabs = await chrome.tabs.query({ windowId, url: YOUTUBE_TAB_PATTERNS });
  const candidates = [...tabs.filter((tab) => tab.active), ...tabs.filter((tab) => tab.pinned)];
  const items = navigable();
  return candidates
    .map((tab) => rows.get(parseVideoId(tab.url ?? "") ?? ""))
    .find((row) => row && items.includes(row.open));
}

/** The row the selection is on, unless it's on one of the row's own buttons. */
function selectedRow(): Row | undefined {
  const active = document.activeElement;
  if (!active?.classList.contains("open")) return undefined;
  return rows.get(active.closest<HTMLElement>(".video")?.dataset.id ?? "");
}

function moveSelection(step: 1 | -1): void {
  const items = navigable();
  const index = items.indexOf(document.activeElement as HTMLElement);
  select(index === -1 ? items[0] : items[index + step]);
}

/** Returns whether the key did something. */
function handleKey(event: KeyboardEvent): boolean {
  const command = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  const row = selectedRow();
  if (key === "z" && command && !event.shiftKey) {
    undoLast();
    return true;
  }
  if (key === "enter" && row) {
    void play(row.root.dataset.id ?? "", command);
    return true;
  }
  if (command || event.altKey) return false;
  switch (key) {
    case "arrowdown":
      moveSelection(1);
      return true;
    case "arrowup":
      moveSelection(-1);
      return true;
    case "escape":
      window.close();
      return true;
    case "backspace":
    case "delete":
      // Not on key repeat: holding it down shouldn't empty the list.
      if (row && !event.repeat) row.remove();
      return Boolean(row);
    case "w":
      if (row && !event.repeat) row.toggleWatched();
      return Boolean(row);
    default:
      return false;
  }
}

document.addEventListener("keydown", (event) => {
  if (handleKey(event)) event.preventDefault();
});

element("export").addEventListener("click", exportList);
element("import").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (file) void importList(file);
});

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[STORAGE_KEY];
  if (area !== "local" || !change) return;
  const next = (change.newValue as Video[] | undefined) ?? [];
  announceFinished(current, next);
  current = next;
  draw(current);
});

void (async () => {
  const [stored, browserWindow] = await Promise.all([chrome.storage.local.get(STORAGE_KEY), chrome.windows.getCurrent()]);
  windowId = browserWindow.id ?? windowId;
  current = (stored[STORAGE_KEY] as Video[] | undefined) ?? [];
  draw(current);
  window.focus();
  select((await rowBeingWatched())?.open ?? navigable()[0]);
  await showEmptyHint();
  await send({ type: "refresh-details" });
})();
