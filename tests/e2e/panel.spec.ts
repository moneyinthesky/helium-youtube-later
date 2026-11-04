import type { BrowserContext, Page, Worker } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  feedUrl,
  openWatchPage,
  row,
  saveLink,
  pressSave,
  seekAndPause,
  signIn,
  STARTED_SECONDS,
  storedVideos,
  test,
  VIDEO_A,
  VIDEO_B,
  VIDEO_SECONDS,
  VIDEO_STARTED,
  watchUrl,
} from "./fixtures";

const tabs = (worker: Worker) =>
  worker.evaluate(() => chrome.tabs.query({}).then((all) => all.map(({ url, pinned, active }) => ({ url, pinned, active }))));

async function pinnedPage(context: BrowserContext, worker: Worker, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  await worker.evaluate(async (u) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === u);
    await chrome.tabs.update(tab!.id!, { pinned: true });
  }, url);
  return page;
}

/** A video that's been played before, so being near the end would finish it. */
const listPlayedVideo = (worker: Worker, id: string) =>
  worker.evaluate(
    (videoId) =>
      chrome.storage.local.set({ videos: [{ id: videoId, title: "T", channel: "C", addedAt: 1, duration: 40, position: 5 }] }),
    id,
  );

test("clicking a video plays it in the pinned YouTube tab", async ({ context, worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_A));
  const pinned = await pinnedPage(context, worker, feedUrl);
  const before = (await tabs(worker)).length;
  await row(panel, VIDEO_A).locator(".open").click();
  await expect(pinned).toHaveURL(watchUrl(VIDEO_A));
  expect(await tabs(worker)).toHaveLength(before);
  expect((await tabs(worker)).find((t) => t.pinned)?.active).toBe(true);
});

test("with no pinned YouTube tab, it pins a new one", async ({ worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_A));
  await row(panel, VIDEO_A).locator(".open").click();
  await expect.poll(() => tabs(worker)).toContainEqual({ url: watchUrl(VIDEO_A), pinned: true, active: true });
});

test("a video already playing in the pinned tab isn't restarted", async ({ context, worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_A));
  const pinned = await pinnedPage(context, worker, watchUrl(VIDEO_A));
  await pinned.evaluate(() => Object.assign(window, { notReloaded: true }));
  await panel.bringToFront();
  await row(panel, VIDEO_A).locator(".open").click();
  await expect.poll(async () => (await tabs(worker)).find((t) => t.pinned)?.active).toBe(true);
  expect(await pinned.evaluate(() => "notReloaded" in window)).toBe(true);
});

test("a part-watched video resumes where you stopped", async ({ context, worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_A));
  await expect(row(panel, VIDEO_A).locator(".time")).toHaveText("0:40");
  const watching = await openWatchPage(context, VIDEO_A);
  await seekAndPause(watching, 20);
  await expect.poll(async () => (await storedVideos(worker))[0]?.position).toBeGreaterThan(19);
  await expect(row(panel, VIDEO_A).locator(".bar")).toBeVisible();
  const pinned = await pinnedPage(context, worker, feedUrl);
  await panel.bringToFront();
  await row(panel, VIDEO_A).locator(".open").click();
  await expect(pinned).toHaveURL(/&t=1[67]s$/);
});

test("a video you'd already started on YouTube shows its progress as soon as it's saved", async ({ context, worker, panel }) => {
  await signIn(context);
  await saveLink(worker, watchUrl(VIDEO_STARTED));
  const fill = row(panel, VIDEO_STARTED).locator(".bar i");
  await expect(fill).toBeVisible();
  await expect(fill).toHaveAttribute("style", `width: ${(STARTED_SECONDS / VIDEO_SECONDS) * 100}%;`);
});

test("signed out, there's no progress to show", async ({ worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_STARTED));
  await expect(row(panel, VIDEO_STARTED).locator(".time")).toHaveText("0:40");
  await expect(row(panel, VIDEO_STARTED).locator(".bar")).toBeHidden();
});

test("videos saved before you'd started them are checked when the panel opens", async ({ context, worker, panel }) => {
  await signIn(context);
  await worker.evaluate((id) => chrome.storage.local.set({ videos: [{ id, title: "Saved earlier", channel: "", addedAt: 1 }] }), VIDEO_STARTED);
  await panel.reload();
  await expect(row(panel, VIDEO_STARTED).locator(".bar")).toBeVisible();
});

test("saving a paused video shows its progress straight away", async ({ context, worker, panel }) => {
  const page = await openWatchPage(context, VIDEO_A);
  await seekAndPause(page, 20);
  await pressSave(worker, page);
  await expect(row(panel, VIDEO_A).locator(".bar")).toBeVisible();
  expect((await storedVideos(worker))[0]?.position).toBeGreaterThan(19);
});

test("a player still at 0 doesn't wipe the saved position", async ({ context, worker, panel }) => {
  await worker.evaluate((id) => chrome.storage.local.set({ videos: [{ id, title: "T", channel: "", addedAt: 1, duration: 40, position: 25 }] }), VIDEO_A);
  await expect(row(panel, VIDEO_A)).toBeVisible();
  const page = await openWatchPage(context, VIDEO_A);
  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    video.dispatchEvent(new Event("pause"));
  });
  await page.waitForTimeout(300);
  expect((await storedVideos(worker))[0]?.position).toBe(25);
});

test("removing a video can be undone", async ({ worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_B));
  await saveLink(worker, watchUrl(VIDEO_A));
  await expect(panel.locator(".video")).toHaveCount(2);
  await row(panel, VIDEO_A).hover();
  await row(panel, VIDEO_A).getByRole("button", { name: "Remove" }).click();
  await expect(row(panel, VIDEO_A)).toHaveCount(0);
  await panel.getByRole("button", { name: "Undo" }).click();
  await expect(panel.locator("#to-watch .video").first()).toHaveAttribute("data-id", VIDEO_A);
});

test("finishing a video moves it to Watched, and it can be put back", async ({ context, worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_A));
  await expect(row(panel, VIDEO_A).locator(".time")).toHaveText("0:40");
  const page = await openWatchPage(context, VIDEO_A);
  await seekAndPause(page, 20);
  await seekAndPause(page, 37);
  await expect(panel.locator(`#watched .video[data-id="${VIDEO_A}"]`)).toBeAttached();
  await expect(panel.locator("#to-watch .video")).toHaveCount(0);
  await expect(panel.locator("#snackbar-text")).toHaveText(`Watched Title of ${VIDEO_A}`);
  await panel.getByRole("button", { name: "Undo" }).click();
  await expect(panel.locator(`#to-watch .video[data-id="${VIDEO_A}"]`)).toBeAttached();
  await expect(panel.locator("#watched-section")).toBeHidden();
  // Still sitting near the end, it has to stay where Undo put it.
  await page.waitForTimeout(500);
  await seekAndPause(page, 38);
  await page.waitForTimeout(300);
  await expect(panel.locator(`#to-watch .video[data-id="${VIDEO_A}"]`)).toBeAttached();
});

test("saving a video near its end doesn't send it straight to Watched", async ({ context, worker, panel }) => {
  const page = await openWatchPage(context, VIDEO_A);
  await seekAndPause(page, 38);
  await pressSave(worker, page);
  await expect(panel.locator(`#to-watch .video[data-id="${VIDEO_A}"]`)).toBeVisible();
  await page.waitForTimeout(500);
  await expect(panel.locator(`#to-watch .video[data-id="${VIDEO_A}"]`)).toBeVisible();
});

test("the Watched section can put a video back", async ({ worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_A));
  await row(panel, VIDEO_A).hover();
  await row(panel, VIDEO_A).getByRole("button", { name: "Mark as watched" }).click();
  await panel.locator("#watched-section summary").click();
  await row(panel, VIDEO_A).hover();
  await row(panel, VIDEO_A).getByRole("button", { name: "Put back in To watch" }).click();
  await expect(panel.locator(`#to-watch .video[data-id="${VIDEO_A}"]`)).toBeVisible();
});

test("ads don't count as watching", async ({ context, worker, panel }) => {
  await listPlayedVideo(worker, VIDEO_A);
  await expect(row(panel, VIDEO_A)).toBeVisible();
  const page = await openWatchPage(context, VIDEO_A);
  await page.evaluate(() => document.querySelector("#movie_player")?.classList.add("ad-showing"));
  await seekAndPause(page, 38);
  await page.evaluate(() => document.querySelector("#movie_player")?.classList.remove("ad-showing"));
  await seekAndPause(page, 10);
  await expect.poll(async () => (await storedVideos(worker))[0]?.position).toBeGreaterThan(9);
  expect((await storedVideos(worker))[0]?.watchedAt).toBeUndefined();
});

test("the last video still in the player doesn't count for the new one", async ({ context, worker, panel }) => {
  await listPlayedVideo(worker, VIDEO_A);
  await expect(row(panel, VIDEO_A)).toBeVisible();
  const page = await openWatchPage(context, VIDEO_B);
  // YouTube changes the URL without loading a page, and the player catches up afterwards.
  await page.evaluate((id) => history.pushState({}, "", `/watch?v=${id}`), VIDEO_A);
  await seekAndPause(page, 38);
  await page.locator("ytd-watch-flexy").evaluate((flexy, id) => flexy.setAttribute("video-id", id), VIDEO_A);
  await seekAndPause(page, 10);
  await expect.poll(async () => (await storedVideos(worker))[0]?.position).toBeGreaterThan(9);
  expect((await storedVideos(worker))[0]?.watchedAt).toBeUndefined();
});

test("videos not in the list aren't tracked", async ({ context, worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_A));
  await expect(row(panel, VIDEO_A)).toBeVisible();
  const page = await openWatchPage(context, VIDEO_B);
  await seekAndPause(page, 38);
  await page.waitForTimeout(300);
  expect((await storedVideos(worker)).map((v) => v.id)).toEqual([VIDEO_A]);
});

test("an export can be imported into an empty list", async ({ worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_A));
  await expect(row(panel, VIDEO_A).locator(".title")).toHaveText(`Title of ${VIDEO_A}`);
  const [download] = await Promise.all([panel.waitForEvent("download"), panel.getByRole("button", { name: "Export" }).click()]);
  const path = join(tmpdir(), `youtube-later-${Date.now()}.json`);
  await download.saveAs(path);
  await worker.evaluate(() => chrome.storage.local.clear());
  await expect(row(panel, VIDEO_A)).toHaveCount(0);
  await panel.locator("#import-file").setInputFiles(path);
  await expect(row(panel, VIDEO_A).locator(".title")).toHaveText(`Title of ${VIDEO_A}`);
  await expect(panel.locator("#snackbar-text")).toHaveText("Imported 1 video");
  expect(JSON.parse(await readFile(path, "utf8")).app).toBe("youtube-later");
});

test("a file that isn't an export is turned away", async ({ panel }) => {
  const path = join(tmpdir(), `not-a-backup-${Date.now()}.json`);
  await writeFile(path, '{"hello":"world"}');
  await panel.locator("#import-file").setInputFiles(path);
  await expect(panel.locator("#snackbar-text")).toHaveText("That isn't a YouTube Later export");
});

test("an empty list says how to add to it", async ({ panel }) => {
  await expect(panel.locator("#empty")).toContainText("Right-click a video link");
});
