import type { Page, Worker } from "@playwright/test";
import { expect, openWatchPage, row, storedVideos, test } from "./fixtures";

const IDS = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"];
const [FIRST, SECOND, THIRD] = IDS as [string, string, string];

const listVideos = (worker: Worker) =>
  worker.evaluate(
    (ids) =>
      chrome.storage.local.set({
        videos: ids.map((id, i) => ({ id, title: `Video ${i}`, channel: "C", addedAt: i, duration: 40, checkedAt: Date.now() })),
      }),
    IDS,
  );

const pinTab = (worker: Worker, url: string) =>
  worker.evaluate(async (tabUrl) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === tabUrl);
    await chrome.tabs.update(tab!.id!, { pinned: true });
  }, url);

/** Three videos, and a panel opened with them already there. */
async function openPanelWithVideos(worker: Worker, panel: Page): Promise<void> {
  await listVideos(worker);
  await panel.reload();
  await expect(row(panel, FIRST).locator(".open")).toBeFocused();
}

const selected = (panel: Page, id: string) => expect(row(panel, id).locator(".open")).toBeFocused();

const ids = async (worker: Worker) => (await storedVideos(worker)).map((v) => v.id);

test("the top video is selected when the panel opens", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await expect(row(panel, FIRST).locator(".actions")).toHaveCSS("opacity", "0");
});

test("the video you're watching is selected, wherever it is in the list", async ({ context, worker, panel }) => {
  await listVideos(worker);
  const watching = await openWatchPage(context, THIRD);
  await watching.bringToFront();
  await panel.reload();
  await selected(panel, THIRD);
});

test("the tab you're on beats the pinned tab", async ({ context, worker, panel }) => {
  await listVideos(worker);
  const pinned = await openWatchPage(context, SECOND);
  await pinTab(worker, pinned.url());
  const watching = await openWatchPage(context, THIRD);
  await watching.bringToFront();
  await panel.reload();
  await selected(panel, THIRD);
});

test("on another page, the video in the pinned tab is selected", async ({ context, worker, panel }) => {
  await listVideos(worker);
  const pinned = await openWatchPage(context, SECOND);
  await pinTab(worker, pinned.url());
  await panel.bringToFront();
  await panel.reload();
  await selected(panel, SECOND);
});

test("a video that isn't in the list leaves the top video selected", async ({ context, worker, panel }) => {
  await listVideos(worker);
  const watching = await openWatchPage(context, "zzzzzzzzzzz");
  await watching.bringToFront();
  await panel.reload();
  await selected(panel, FIRST);
});

test("a video in the closed Watched section leaves the top video selected", async ({ context, worker, panel }) => {
  await worker.evaluate(
    ([top, done]) =>
      chrome.storage.local.set({
        videos: [
          { id: top, title: "Top", channel: "C", addedAt: 2, duration: 40, checkedAt: Date.now() },
          { id: done, title: "Done", channel: "C", addedAt: 1, duration: 40, watchedAt: Date.now() },
        ],
      }),
    [FIRST, THIRD],
  );
  const watching = await openWatchPage(context, THIRD);
  await watching.bringToFront();
  await panel.reload();
  await selected(panel, FIRST);
});

test("the arrow keys move through the list, and stop at the ends", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("ArrowUp");
  await selected(panel, FIRST);
  await panel.keyboard.press("ArrowDown");
  await selected(panel, SECOND);
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("ArrowDown");
  await selected(panel, THIRD);
  await panel.keyboard.press("ArrowUp");
  await selected(panel, SECOND);
});

test("the arrow keys pick the selection back up after clicking elsewhere", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.evaluate(() => (document.activeElement as HTMLElement).blur());
  await panel.keyboard.press("ArrowDown");
  await selected(panel, FIRST);
});

test("Enter plays the video and hides the panel", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("ArrowDown");
  const closed = panel.waitForEvent("close");
  await panel.keyboard.press("Enter");
  await closed;
  const tabs = await worker.evaluate(() => chrome.tabs.query({ pinned: true }));
  expect(tabs[0]?.pendingUrl ?? tabs[0]?.url).toContain(SECOND);
});

test("⌘Enter plays the video and keeps the panel open", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("Meta+Enter");
  await expect
    .poll(() => worker.evaluate(() => chrome.tabs.query({ pinned: true }).then((t) => t[0]?.pendingUrl ?? t[0]?.url)))
    .toContain(FIRST);
  expect(panel.isClosed()).toBe(false);
});

test("clicking hides the panel, and ⌘-click doesn't", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await row(panel, SECOND).locator(".open").click({ modifiers: ["Meta"] });
  await expect.poll(() => worker.evaluate(() => chrome.tabs.query({ pinned: true }).then((t) => t.length))).toBe(1);
  expect(panel.isClosed()).toBe(false);
  const closed = panel.waitForEvent("close");
  await row(panel, THIRD).locator(".open").click();
  await closed;
});

test("Esc hides the panel without playing anything", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  const closed = panel.waitForEvent("close");
  await panel.keyboard.press("Escape").catch(() => {}); // the page can close before the press finishes
  await closed;
  expect(await worker.evaluate(() => chrome.tabs.query({ pinned: true }))).toHaveLength(0);
});

test("Backspace removes the video and selects the next one", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("Backspace");
  await expect(row(panel, FIRST)).toHaveCount(0);
  await selected(panel, SECOND);
  await panel.keyboard.press("Backspace");
  await expect(row(panel, SECOND)).toHaveCount(0);
  await selected(panel, THIRD);
  expect(await ids(worker)).toEqual([THIRD]);
});

test("removing the last video in the list selects the one above", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("Delete");
  await expect(row(panel, THIRD)).toHaveCount(0);
  await selected(panel, SECOND);
});

test("holding Backspace down removes one video, not the whole list", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.down("Backspace");
  await panel.keyboard.down("Backspace"); // a second down with no up is a key repeat
  await panel.keyboard.down("Backspace");
  await panel.keyboard.up("Backspace");
  await expect(row(panel, FIRST)).toHaveCount(0);
  expect(await ids(worker)).toEqual([SECOND, THIRD]);
});

test("⌘Z brings back a removed video, selected, even after the snackbar's gone", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("Backspace");
  await expect(row(panel, SECOND)).toHaveCount(0);
  await panel.evaluate(() => ((document.getElementById("snackbar") as HTMLElement).hidden = true));
  await panel.keyboard.press("Meta+z");
  await selected(panel, SECOND);
  expect(await ids(worker)).toEqual(IDS);
});

test("W moves the video to Watched and selects the next one, and ⌘Z undoes it", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("w");
  await expect(panel.locator(`#watched .video[data-id="${FIRST}"]`)).toBeAttached();
  await selected(panel, SECOND);
  await panel.keyboard.press("Meta+z");
  await expect(panel.locator(`#to-watch .video[data-id="${FIRST}"]`)).toBeAttached();
  await selected(panel, FIRST);
});

test("the Watched section can be opened and used from the keyboard", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("w");
  await selected(panel, SECOND);
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("ArrowDown");
  await expect(panel.locator("#watched-section summary")).toBeFocused();
  await panel.keyboard.press("ArrowDown"); // closed, so there's nothing below it
  await expect(panel.locator("#watched-section summary")).toBeFocused();
  await panel.keyboard.press("Enter");
  await expect(panel.locator("#watched-section")).toHaveAttribute("open");
  await panel.keyboard.press("ArrowDown");
  await selected(panel, FIRST);
  await panel.keyboard.press("w");
  await expect(panel.locator(`#to-watch .video[data-id="${FIRST}"]`)).toBeAttached();
});

test("the selection survives the list changing around it", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("ArrowDown");
  // A new video saved from the page, and a video finishing elsewhere.
  await worker.evaluate(async () => {
    const { videos } = (await chrome.storage.local.get("videos")) as { videos: object[] };
    await chrome.storage.local.set({ videos: [{ id: "ddddddddddd", title: "New", channel: "C", addedAt: 9, checkedAt: Date.now() }, ...videos] });
  });
  await expect(row(panel, "ddddddddddd")).toBeAttached();
  await selected(panel, SECOND);
  await worker.evaluate(async (id) => {
    const { videos } = (await chrome.storage.local.get("videos")) as { videos: { id: string }[] };
    await chrome.storage.local.set({ videos: videos.map((v) => (v.id === id ? { ...v, watchedAt: 5 } : v)) });
  }, SECOND);
  await selected(panel, THIRD);
});

test("keys on a row's own buttons do what the button does", async ({ worker, panel }) => {
  await openPanelWithVideos(worker, panel);
  await panel.keyboard.press("Tab"); // to the first row's ✓
  await expect(row(panel, FIRST).getByRole("button", { name: "Mark as watched" })).toBeFocused();
  await expect(row(panel, FIRST).locator(".actions")).toHaveCSS("opacity", "1");
  await panel.keyboard.press("Enter");
  await expect(panel.locator(`#watched .video[data-id="${FIRST}"]`)).toBeAttached();
  expect(panel.isClosed()).toBe(false);
});

test("the key hints only show when there's a list", async ({ worker, panel }) => {
  await expect(panel.locator("#keys")).toBeHidden();
  await openPanelWithVideos(worker, panel);
  await expect(panel.locator("#keys")).toHaveText(/play.*remove.*watched/s);
});
