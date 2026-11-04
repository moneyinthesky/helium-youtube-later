# YouTube Later for Helium

A side panel for keeping track of the YouTube videos you want to watch later, for [Helium](https://helium.computer). It also works in Chrome.

Manifest V3, plain TypeScript, no frameworks, no analytics. Your list stays in the browser.

## Install

You need [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm build
```

Then in Helium (or Chrome):

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.

After pulling changes, run `pnpm build` again and click the reload icon on the extension's card. YouTube tabs that are already open reconnect on their own.

## Using it

| Do this | To |
|---|---|
| **⌘⇧Y** (Ctrl+Shift+Y), or click the toolbar icon | Open or close the panel |
| **⌘⇧S** (Ctrl+Shift+S) on YouTube | Save the thumbnail under the pointer, or if there isn't one, the video you're on |
| Right-click a YouTube link, on any site | **Save video to YouTube Later** |
| Click a video in the panel | Play it in your pinned YouTube tab |
| Hover over a video in the panel | ✓ mark as watched, ✕ remove |

Saving on YouTube shows a card at the top right of the page, with the video's thumbnail, so you can see which one you got. The toolbar icon's badge counts what's left to watch. Change the shortcuts at `chrome://extensions/shortcuts`.

### Playing a video

Videos open in your pinned YouTube tab, replacing what's playing there. The pinned tab in the current window comes first, then one in any other window. If you have none, a new pinned tab is made. If the pinned tab is already showing that video, it just switches to it.

Videos you've started resume about where you stopped, and show a red progress bar. Anything under 10 seconds in starts from the beginning.

That includes videos you started before saving them, as long as you're signed in to YouTube in this browser: YouTube's resume position is read when you save a video. Videos you haven't played since saving them are checked again, at most once a day, when the panel opens. Once you've played a video, its progress comes from the player instead, so watching it on another device doesn't change the panel.

### Finishing a video

A video moves to the **Watched** section when playback ends, or when it passes 90%. On long videos it's never more than two minutes from the end, so a three-hour video isn't finished with 18 minutes left. Undo appears in the panel if it's open, and ↩ in the Watched section puts a video back any time. Watched videos are deleted after 30 days.

Ads don't count as watching, and only videos in your list are tracked.

### Backups

**Export** saves your list as a JSON file, and **Import** adds a file's videos to your list. Videos already in the list are left as they are. The list isn't synced between browsers or devices, so this is also how to move it.

## Known limitations

- **Helium's Zen mode:** the top toolbar stays visible while the panel is open, even if you've unpinned it. Helium does this for every side panel, and extensions can't change it.
- **Save shortcut:** it only works on YouTube. On other sites, right-click the link. Right-clicking on another site shows no card, only the badge going up, which Zen mode hides.
- **YouTube's own player menu:** right-clicking the player shows YouTube's menu, not the browser's. Use the shortcut there.
- **Fullscreen:** the panel isn't available in fullscreen video, but the save shortcut and its toast are.
- **Private and deleted videos:** they're saved, but show as "YouTube video", because their details can't be looked up. The lookup is tried again each time the panel opens.
- **Live streams:** they have no length or progress, so they don't move to Watched on their own.
- **YouTube's Watch Later list:** this is a separate list. Nothing is read from it or added to it.

## Permissions

| Permission | Why |
|---|---|
| `sidePanel` | Show the panel. |
| `storage` | Keep your list in the browser. |
| `contextMenus` | Add the right-click item. |
| `scripting` | Reconnect YouTube tabs that are already open when the extension is installed or updated. |
| Access to `www.youtube.com` and `m.youtube.com` | Find your pinned YouTube tab, report playback of videos in your list, and look up a video's title, channel, length and your resume position. |

The extension talks to nothing but YouTube, and loads thumbnails from `i.ytimg.com`. There's no access to any other site: the right-click item gets the link you chose from the browser.

## How it stays working when YouTube changes

Saving depends on as little of YouTube's page as possible. All it needs is a video ID, from a link or the address bar. Details come from YouTube's public oEmbed endpoint, and the length and resume position from the player data in the watch page. That page is fetched with your YouTube cookies, which is how it knows your position. Fetching it doesn't add anything to your watch history, because nothing plays.

Playback tracking does depend on the page: `#movie_player video`, the `ad-showing` class, and the `video-id` attribute of `ytd-watch-flexy`. If YouTube changes those, saving and playing keep working, and the things to check are progress and auto-moving to Watched. See [TESTING.md](TESTING.md).

## Development

```bash
pnpm dev             # rebuild dist/ on every save
pnpm typecheck
pnpm test            # unit tests: the list, URLs, backups
pnpm test:e2e        # end-to-end tests in a headless Helium, against a fake YouTube
pnpm check:shortcut  # does the browser assign the shortcuts to a fresh install?
pnpm icons           # re-render src/icons/*.png from assets/icon.svg (uses Helium)
```

The end-to-end tests use a separate build in `dist-e2e/`, which treats a local test server as YouTube. Don't load it as your everyday extension. The test browser can only reach that server, never the internet, so nothing there proves the real YouTube still behaves the same way. Real key presses, the toolbar icon and the right-click menu can't be automated either. Use [TESTING.md](TESTING.md) for those.

### Layout

| Path | What's there |
|---|---|
| `src/core/` | Pure logic: the list, YouTube's URLs and pages, backups, messages |
| `src/background/` | Service worker: saving, the store, details lookup, the pinned tab |
| `src/content/` | Runs on YouTube: what to save, toasts, playback reports |
| `src/panel/` | The side panel |
| `tests/unit/`, `tests/e2e/` | Tests |

## License

[MIT](LICENSE)
