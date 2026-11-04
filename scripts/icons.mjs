// Renders assets/icon.svg into the PNG sizes the manifest uses, in src/icons/.
// Run after changing the SVG: pnpm icons. The PNGs are committed, so a normal
// build doesn't need a browser.
//   BROWSER=/path/to/binary pnpm icons
import { chromium } from "playwright-core";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const executablePath = process.env.BROWSER ?? "/Applications/Helium.app/Contents/MacOS/Helium";

// Chrome's guidance: the 128 px icon keeps a 16 px transparent margin (96 px of
// artwork); smaller sizes fill the whole square to stay legible.
const SIZES = [
  { size: 16, padding: 0 },
  { size: 32, padding: 0 },
  { size: 48, padding: 0 },
  { size: 128, padding: 16 },
];

const svg = await readFile(`${root}assets/icon.svg`, "utf8");
await mkdir(`${root}src/icons`, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const { size, padding } of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const art = size - padding * 2;
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${art}px;height:${art}px;margin:${padding}px}</style>${svg}`,
    );
    await page.screenshot({ path: `${root}src/icons/icon-${size}.png`, omitBackground: true });
    await page.close();
    console.log(`src/icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
