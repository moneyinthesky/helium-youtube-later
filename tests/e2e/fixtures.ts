import { test as base, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_ORIGIN } from "./origin";

// Built by `pnpm test:e2e` with --e2e: see scripts/build.mjs.
const dist = fileURLToPath(new URL("../../dist-e2e", import.meta.url));

/** Helium by default; set BROWSER to test another Chromium build. */
const executablePath = process.env.BROWSER ?? "/Applications/Helium.app/Contents/MacOS/Helium";

/** Helium's bundled uBlock Origin, which `--disable-extensions-except` leaves running. */
const UBLOCK_ID = "blockjmkbacgjkknlgpkjjiijinjdanf";

/** Every fake video lasts this long. */
export const VIDEO_SECONDS = 40;

export const VIDEO_A = "aaaaaaaaaaa";
export const VIDEO_B = "bbbbbbbbbbb";
/** oEmbed refuses this one, as it does for private videos. */
export const VIDEO_PRIVATE = "ppppppppppp";
/** The e2e build doesn't add the content script to this one's page. See scripts/build.mjs. */
export const VIDEO_DISCONNECTED = "disconnecte";
/** You're part way through this one on YouTube, which the watch page only says if you're signed in. */
export const VIDEO_STARTED = "sssssssssss";
export const STARTED_SECONDS = 10;
/** oEmbed refuses this one until a test calls recoverFlakyVideo, as if the network had dropped. */
export const VIDEO_FLAKY = "fffffffffff";

/** Silent audio, which a <video> plays and seeks like any other. */
function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const size = rate * seconds;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + size, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(size, 40);
  return Buffer.concat([header, Buffer.alloc(size, 128)]);
}

const wav = silentWav(VIDEO_SECONDS);

function sendMedia(range: string | undefined, res: ServerResponse): void {
  const match = /bytes=(\d+)-(\d*)/.exec(range ?? "");
  if (!match) {
    res.writeHead(200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Length": wav.length });
    res.end(wav);
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : wav.length - 1;
  res.writeHead(206, {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Content-Range": `bytes ${start}-${end}/${wav.length}`,
    "Content-Length": end - start + 1,
  });
  res.end(wav.subarray(start, end + 1));
}

/** Just enough of YouTube: what the extension reads, and nothing else. */
const watchPage = (id: string, signedIn: boolean) => `<!doctype html><title>Watching ${id}</title>
  <ytd-watch-flexy video-id="${id}"><div id="movie_player"><video src="/media.wav" muted></video></div></ytd-watch-flexy>
  <script>var data = {"videoDetails":{"videoId":"${id}","title":"x","lengthSeconds":"${VIDEO_SECONDS}"}${
    signedIn && id === VIDEO_STARTED ? `,"playerConfig":{"playbackStartConfig":{"startSeconds":${STARTED_SECONDS}}}` : ""
  }};</script>`;

const feedPage = `<!doctype html><title>Feed</title><h1>Feed</h1>
  <a id="thumb-a" href="/watch?v=${VIDEO_A}&pp=abc" style="display:block;height:100px">Thumbnail A</a>
  <a id="thumb-b" href="/shorts/${VIDEO_B}" style="display:block;height:100px">Thumbnail B</a>`;

type Fixtures = { context: BrowserContext; worker: Worker; panel: Page };

export const test = base.extend<Fixtures, { server: void }>({
  server: [
    async ({}, use) => {
      let flakyRecovered = false;
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", E2E_ORIGIN);
        if (url.pathname === "/media.wav") return sendMedia(req.headers.range, res);
        if (url.pathname === "/recover") {
          flakyRecovered = true;
          res.end();
          return;
        }
        if (url.pathname === "/oembed") {
          const id = new URL(url.searchParams.get("url") ?? "").searchParams.get("v");
          if (id === VIDEO_PRIVATE || (id === VIDEO_FLAKY && !flakyRecovered)) {
            res.writeHead(401);
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ title: `Title of ${id}`, author_name: `Channel of ${id}` }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        const signedIn = req.headers.cookie?.includes("SID=") ?? false;
        res.end(url.pathname === "/watch" ? watchPage(url.searchParams.get("v") ?? "", signedIn) : feedPage);
      });
      const { port } = new URL(E2E_ORIGIN);
      await new Promise<void>((resolve) => server.listen(Number(port), "127.0.0.1", resolve));
      await use();
      server.close();
    },
    { scope: "worker", auto: true },
  ],
  context: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), "youtube-later-e2e-"));
    const context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: true,
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        // Nothing but the local test server resolves, so no test can reach the network.
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    // While its filter lists load, uBlock reloads every page that opened in the meantime.
    const page = await context.newPage();
    await page.goto("chrome://extensions");
    await page.locator("extensions-item").first().waitFor();
    const toggle = page.locator(`extensions-item#${UBLOCK_ID} #enableToggle`);
    if ((await toggle.count()) > 0) await toggle.click();
    await page.close();
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },
  worker: async ({ context }, use) => {
    await use(context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker")));
  },
  // The real panel page, in a tab: Playwright can't reach into the side panel itself.
  panel: async ({ context, worker }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    await use(page);
  },
});

export const expect = test.expect;

/** Signs in to the fake YouTube, with the same kind of cookie as the real one. */
export const signIn = (context: BrowserContext) =>
  context.addCookies([{ name: "SID", value: "test", url: E2E_ORIGIN, sameSite: "Lax", httpOnly: true }]);

export const recoverFlakyVideo = () => fetch(`${E2E_ORIGIN}/recover`);

export const watchUrl = (id: string) => `${E2E_ORIGIN}/watch?v=${id}`;
export const feedUrl = `${E2E_ORIGIN}/feed`;

/** Opens a watch page, with the content script listening. */
export async function openWatchPage(context: BrowserContext, id: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(watchUrl(id));
  await page.locator("video").evaluate(
    (video: HTMLVideoElement) =>
      new Promise((resolve) => (video.readyState > 0 ? resolve(null) : video.addEventListener("loadedmetadata", resolve))),
  );
  return page;
}

/** What pressing the save shortcut does, on the tab showing `page`. */
export async function pressSave(worker: Worker, page: Page): Promise<void> {
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    const hooks = (globalThis as unknown as { __test: { onCommand(c: string, t?: chrome.tabs.Tab): Promise<void> } }).__test;
    await hooks.onCommand("save-video", tab);
  }, page.url());
}

/** What choosing the right-click item on a link does. */
export async function saveLink(worker: Worker, linkUrl: string): Promise<void> {
  await worker.evaluate(async (url) => {
    const hooks = (globalThis as unknown as { __test: { onContextMenu(i: unknown): Promise<void> } }).__test;
    await hooks.onContextMenu({ menuItemId: "save-link", linkUrl: url, pageUrl: "https://example.com/" });
  }, linkUrl);
}

/** Moves the player to `seconds` and lets the page report it. */
export async function seekAndPause(page: Page, seconds: number): Promise<void> {
  await page.locator("video").evaluate(async (video: HTMLVideoElement, position) => {
    await video.play();
    video.currentTime = position;
    await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
    video.pause();
  }, seconds);
}

export const storedVideos = (worker: Worker) =>
  worker.evaluate(async () => {
    const { videos } = await chrome.storage.local.get("videos");
    return (videos ?? []) as { id: string; title: string; position?: number; watchedAt?: number; duration?: number }[];
  });

export const row = (panel: Page, id: string) => panel.locator(`.video[data-id="${id}"]`);

export const toast = (page: Page) => page.locator('[data-youtube-later-toast] [role="status"]');
