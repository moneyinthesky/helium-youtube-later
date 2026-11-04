# Manual checks

The automated tests use a fake YouTube and can't press real keys, so run these in Helium before relying on a change. Load `dist/`, not `dist-e2e/`.

## Panel

- [ ] ⌘⇧Y opens the panel. ⌘⇧Y again closes it.
- [ ] The toolbar icon does the same.
- [ ] `pnpm check:shortcut` reports both shortcuts as assigned.

- [ ] Open the panel with the shortcut while on a page. ↑ and ↓ work straight away, without clicking the panel.
- [ ] Open the panel while watching a video further down the list. That video is selected, and scrolled into view.
- [ ] Enter plays the selected video and hides the panel, and with Zen mode's top bar unpinned, the toolbar goes too.
- [ ] After Enter, YouTube's own keys work in the pinned tab without clicking it (K to pause).
- [ ] A key chosen on `chrome://extensions/shortcuts` toggles the panel. For ⌘Y on a Mac, see the README first.

## Saving

- [ ] On a video, ⌘⇧S shows a card at the top right with its thumbnail and "Saved to YouTube Later", and it appears in the panel with thumbnail, title, channel and length.
- [ ] Reload the extension on `chrome://extensions`, then press ⌘⇧S in a YouTube tab that was already open, without refreshing it. The card still appears.
- [ ] The card shows over fullscreen video.
- [ ] On the home page, point at a thumbnail and press ⌘⇧S. That video is saved, including once its preview starts playing.
- [ ] On a Shorts page, ⌘⇧S saves the Short.
- [ ] Right-click a thumbnail on YouTube and choose **Save video to YouTube Later**.
- [ ] Right-click a YouTube link on another site, and do the same.
- [ ] Saving the same video again says "Already in YouTube Later".

## Playing

- [ ] With a pinned YouTube tab, clicking a video plays it there, in the same tab.
- [ ] With no pinned YouTube tab, clicking a video makes one.
- [ ] Watch part of a video, then click it in the panel from another tab. It resumes, and has a progress bar.

- [ ] Watch part of a video on YouTube, close it, then save it from a thumbnail. Its progress bar appears without playing it.
- [ ] Pause a video part way through and press ⌘⇧S. Its progress bar appears straight away.

## Finishing

- [ ] Scrub past 90% of a saved video and let it play. It moves to Watched, and Undo brings it back.
- [ ] A video with a pre-roll ad doesn't move or change progress during the ad.
- [ ] Near the end of an unsaved video, click a saved video in the recommendations. The saved video doesn't jump to Watched or pick up the old position.
