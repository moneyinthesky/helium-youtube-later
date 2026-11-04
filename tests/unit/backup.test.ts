import { describe, expect, it } from "vitest";
import { mergeBackup, parseBackup, toBackup } from "../../src/core/backup";
import { formatDuration } from "../../src/core/format";
import type { Video } from "../../src/core/videos";

const video = (id: string, title = "Title"): Video => ({ id, title, channel: "Channel", addedAt: 1 });
const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";

describe("backups", () => {
  it("round-trips", () => {
    const videos = [video(A), { ...video(B), duration: 60, position: 10, watchedAt: 5 }];
    expect(parseBackup(toBackup(videos))).toEqual(videos);
  });

  it.each([["not json"], ["null"], ["[]"], ['{"videos":[]}'], ['{"app":"other","videos":[]}'], ['{"app":"youtube-later"}']])(
    "rejects %s",
    (text) => {
      expect(parseBackup(text)).toBeNull();
    },
  );

  it("drops malformed videos and unknown fields", () => {
    const text = JSON.stringify({
      app: "youtube-later",
      videos: [
        { ...video(A), extra: "<script>" },
        { ...video("bad id"), title: "x" },
        { id: B },
        null,
        { ...video(B), duration: "long" },
      ],
    });
    expect(parseBackup(text)).toEqual([video(A), video(B)]);
  });

  it("keeps what's already in the list, and doesn't add anything twice", () => {
    const merged = mergeBackup([video(A, "Mine")], [video(A, "Theirs"), video(B), video(B)]);
    expect(merged).toEqual([video(A, "Mine"), video(B)]);
  });
});

describe("formatDuration", () => {
  it.each([
    [5, "0:05"],
    [75, "1:15"],
    [3675, "1:01:15"],
    [635.9, "10:35"],
  ])("%s → %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
