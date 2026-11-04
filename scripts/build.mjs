// Bundles the extension into dist/.
//   --watch  rebuild on change
//   --e2e    test build in dist-e2e/: treats the local test server as YouTube
//            (see E2E_ORIGIN in src/core/youtube.ts)
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const watch = process.argv.includes("--watch");
const e2e = process.argv.includes("--e2e");
const dist = `${root}${e2e ? "dist-e2e" : "dist"}`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const copyStatic = async () => {
  const manifest = JSON.parse(await readFile(`${root}src/manifest.json`, "utf8"));
  if (e2e) {
    manifest.host_permissions.push("http://127.0.0.1/*");
    manifest.content_scripts[0].matches.push("http://127.0.0.1/*");
    // A page the browser doesn't add the script to, like a tab left over from before an update.
    manifest.content_scripts[0].exclude_matches = ["http://127.0.0.1/watch?v=disconnecte*"];
  }
  await writeFile(`${dist}/manifest.json`, JSON.stringify(manifest, null, 2));
  await cp(`${root}src/panel/panel.html`, `${dist}/panel.html`);
  await cp(`${root}src/panel/panel.css`, `${dist}/panel.css`);
  await cp(`${root}src/icons`, `${dist}/icons`, { recursive: true });
};

/** @type {esbuild.BuildOptions} */
const shared = {
  outdir: dist,
  bundle: true,
  target: "chrome121",
  define: { __E2E__: String(e2e) },
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
};

const builds = [
  {
    ...shared,
    entryPoints: {
      "service-worker": `${root}src/background/service-worker.ts`,
      panel: `${root}src/panel/main.ts`,
    },
    format: "esm",
    plugins: [{ name: "copy-static", setup: (b) => b.onEnd(copyStatic) }],
  },
  // Content scripts run as classic scripts.
  { ...shared, entryPoints: { content: `${root}src/content/main.ts` }, format: "iife" },
];

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
