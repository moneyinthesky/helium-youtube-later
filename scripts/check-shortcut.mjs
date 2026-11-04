// Loads dist/ into a throwaway Helium (or Chrome) profile and reports whether
// Chromium actually assigned the suggested shortcuts.
//   BROWSER=/path/to/binary pnpm check:shortcut
import { chromium } from "playwright-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const executablePath = process.env.BROWSER ?? "/Applications/Helium.app/Contents/MacOS/Helium";
const profile = await mkdtemp(join(tmpdir(), "youtube-later-profile-"));

const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    // Branded Chrome 137+ ignores --load-extension unless this is disabled.
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});

try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10_000 }).catch(() => {
      throw new Error(
        "Extension did not load. Recent branded Chrome ignores --load-extension; " +
          "use Helium/Chromium here and check Chrome by hand via Load unpacked.",
      );
    }));
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  console.log(`browser: ${executablePath} (${context.browser()?.version() ?? "unknown"})`);
  for (const name of ["_execute_action", "save-video"]) {
    const shortcut = commands.find((c) => c.name === name)?.shortcut;
    if (shortcut) {
      console.log(`OK: ${name} is bound to ${shortcut}`);
    } else {
      console.log(`FAIL: ${name} has no shortcut assigned`);
      process.exitCode = 1;
    }
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
