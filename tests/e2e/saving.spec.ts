import {
  expect,
  feedUrl,
  openWatchPage,
  pressSave,
  recoverFlakyVideo,
  row,
  saveLink,
  storedVideos,
  test,
  toast,
  VIDEO_A,
  VIDEO_B,
  VIDEO_DISCONNECTED,
  VIDEO_FLAKY,
  VIDEO_PRIVATE,
  watchUrl,
} from "./fixtures";

test("the shortcut saves the video you're watching, with its details", async ({ context, worker, panel }) => {
  const page = await openWatchPage(context, VIDEO_A);
  await pressSave(worker, page);
  await expect(toast(page)).toHaveText("Saved to YouTube Later");
  await expect(toast(page).locator("img")).toHaveAttribute("src", `https://i.ytimg.com/vi/${VIDEO_A}/mqdefault.jpg`);
  const entry = row(panel, VIDEO_A);
  await expect(entry.locator(".title")).toHaveText(`Title of ${VIDEO_A}`);
  await expect(entry.locator(".channel")).toHaveText(`Channel of ${VIDEO_A}`);
  await expect(entry.locator(".time")).toHaveText("0:40");
  await expect(entry.locator("img")).toHaveAttribute("src", `https://i.ytimg.com/vi/${VIDEO_A}/mqdefault.jpg`);
  await expect(panel.locator("#count")).toHaveText("1");
});

test("the shortcut saves the thumbnail under the pointer", async ({ context, worker, panel }) => {
  const page = await context.newPage();
  await page.goto(feedUrl);
  await page.hover("#thumb-b");
  await pressSave(worker, page);
  await expect(row(panel, VIDEO_B)).toBeVisible();
});

test("pointing at a thumbnail beats the video you're watching", async ({ context, worker, panel }) => {
  const page = await openWatchPage(context, VIDEO_A);
  await page.evaluate((id) => {
    document.body.insertAdjacentHTML("beforeend", `<a id="next" href="/watch?v=${id}">Next</a>`);
  }, VIDEO_B);
  await page.hover("#next");
  await pressSave(worker, page);
  await expect(row(panel, VIDEO_B)).toBeVisible();
  await expect(row(panel, VIDEO_A)).toHaveCount(0);
});

test("saving another video replaces the confirmation, and shows the new one", async ({ context, worker, panel }) => {
  const page = await context.newPage();
  await page.goto(feedUrl);
  await page.hover("#thumb-a");
  await pressSave(worker, page);
  await expect(toast(page).locator("img")).toHaveAttribute("src", /aaaaaaaaaaa/);
  await page.hover("#thumb-b");
  await pressSave(worker, page);
  await expect(toast(page).locator("img")).toHaveAttribute("src", /bbbbbbbbbbb/);
  await expect(toast(page)).toHaveCount(1);
  await expect(row(panel, VIDEO_B)).toBeVisible();
});

test("tabs opened before an update still confirm saves, without a refresh", async ({ context, worker }) => {
  const page = await openWatchPage(context, VIDEO_DISCONNECTED);
  await pressSave(worker, page);
  await page.waitForTimeout(300);
  expect(await toast(page).count()).toBe(0); // saved from the URL, with nothing on the page to say so
  expect((await storedVideos(worker)).map((v) => v.id)).toEqual([VIDEO_DISCONNECTED]);

  await worker.evaluate(() =>
    (globalThis as unknown as { __test: { connectOpenTabs(): Promise<void> } }).__test.connectOpenTabs(),
  );
  await pressSave(worker, page);
  await expect(toast(page)).toHaveText("Already in YouTube Later");
});

test("with no video to save, the shortcut says so", async ({ context, worker, panel }) => {
  const page = await context.newPage();
  await page.goto(feedUrl);
  await page.hover("h1");
  await pressSave(worker, page);
  await expect(toast(page)).toHaveText("Point at a thumbnail, or open a video, to save it");
  await expect(panel.locator(".video")).toHaveCount(0);
});

test("the right-click item saves a link from any site", async ({ worker, panel }) => {
  await saveLink(worker, `https://youtu.be/${VIDEO_A}?si=shared`);
  await expect(row(panel, VIDEO_A).locator(".title")).toHaveText(`Title of ${VIDEO_A}`);
});

test("saving a video twice keeps one copy, and says so", async ({ context, worker, panel }) => {
  const page = await openWatchPage(context, VIDEO_A);
  await pressSave(worker, page);
  await expect(row(panel, VIDEO_A)).toBeVisible();
  await pressSave(worker, page);
  await expect(toast(page)).toHaveText("Already in YouTube Later");
  expect(await storedVideos(worker)).toHaveLength(1);
});

test("a video with no details is still saved", async ({ worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_PRIVATE));
  await expect(row(panel, VIDEO_PRIVATE).locator(".title")).toHaveText("YouTube video");
  await expect(row(panel, VIDEO_PRIVATE).locator(".time")).toHaveText("0:40");
});

test("missing details are tried again when the panel opens", async ({ worker, panel }) => {
  await saveLink(worker, watchUrl(VIDEO_FLAKY));
  await expect(row(panel, VIDEO_FLAKY).locator(".title")).toHaveText("YouTube video");
  await recoverFlakyVideo();
  await panel.reload();
  await expect(row(panel, VIDEO_FLAKY).locator(".title")).toHaveText(`Title of ${VIDEO_FLAKY}`);
});

test("the badge counts what's left to watch", async ({ worker, panel }) => {
  const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));
  await saveLink(worker, watchUrl(VIDEO_A));
  await saveLink(worker, watchUrl(VIDEO_B));
  await expect.poll(badge).toBe("2");
  await row(panel, VIDEO_A).hover();
  await row(panel, VIDEO_A).getByRole("button", { name: "Mark as watched" }).click();
  await expect.poll(badge).toBe("1");
});
