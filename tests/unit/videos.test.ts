import { describe, expect, it } from "vitest";
import {
  addVideo,
  applyMetadata,
  applyProgress,
  isFinished,
  markWatched,
  needsDetails,
  progressOf,
  pruneWatched,
  putBack,
  removeVideo,
  restoreVideo,
  resumeAt,
  toWatch,
  watched,
  WATCHED_RETENTION_MS,
  type Video,
} from "../../src/core/videos";

const video = (id: string, extra: Partial<Video> = {}): Video => ({
  id,
  title: `Title ${id}`,
  channel: "Channel",
  addedAt: 1,
  ...extra,
});

describe("addVideo", () => {
  it("puts new videos first", () => {
    const { videos, result } = addVideo([video("a")], "b", 5);
    expect(result).toBe("added");
    expect(videos.map((v) => v.id)).toEqual(["b", "a"]);
    expect(videos[0]).toEqual({ id: "b", title: "", channel: "", addedAt: 5, finishHeld: true });
  });

  it("leaves a video that's already there alone", () => {
    const list = [video("a"), video("b", { position: 40 })];
    expect(addVideo(list, "b", 5)).toEqual({ videos: list, result: "exists" });
  });

  it("brings a watched video back to the top, from the start", () => {
    const { videos, result } = addVideo([video("a"), video("b", { watchedAt: 3, duration: 90 })], "b", 5);
    expect(result).toBe("restored");
    expect(videos[0]).toEqual(video("b", { addedAt: 5, duration: 90, finishHeld: true }));
    expect(videos).toHaveLength(2);
  });
});

describe("undo", () => {
  it("puts a removed video back where it was", () => {
    const list = [video("a"), video("b"), video("c")];
    const removed = removeVideo(list, "b");
    expect(restoreVideo(removed, list[1]!, 1).map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("restores a video that's still there, without adding it twice", () => {
    const before = video("a", { position: 30 });
    const after = markWatched([before], "a", 5);
    expect(restoreVideo(after, before, 0)).toEqual([{ ...before, finishHeld: true }]);
  });
});

describe("markWatched and putBack", () => {
  it("moves between the two sections, forgetting the position", () => {
    const list = markWatched([video("a", { position: 30 }), video("b")], "a", 5);
    expect(watched(list).map((v) => v.id)).toEqual(["a"]);
    expect(toWatch(list).map((v) => v.id)).toEqual(["b"]);
    expect(watched(list)[0]?.position).toBeUndefined();
    expect(toWatch(putBack(list, "a")).map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("lists the most recently watched first", () => {
    const list = [video("a", { watchedAt: 1 }), video("b", { watchedAt: 3 }), video("c", { watchedAt: 2 })];
    expect(watched(list).map((v) => v.id)).toEqual(["b", "c", "a"]);
  });
});

describe("applyMetadata", () => {
  it("keeps what a failed lookup didn't return", () => {
    const list = [video("a", { duration: 60 })];
    expect(applyMetadata(list, "a", { title: "New" })[0]).toEqual(video("a", { title: "New", duration: 60 }));
  });
});

describe("applyMetadata and progress", () => {
  it("takes YouTube's position for a video not played here", () => {
    expect(applyMetadata([video("a")], "a", { position: 505 })[0]?.position).toBe(505);
  });

  it("keeps a position seen here", () => {
    expect(applyMetadata([video("a", { position: 40 })], "a", { position: 505 })[0]?.position).toBe(40);
  });

  it("doesn't give a watched video a position", () => {
    expect(applyMetadata([video("a", { watchedAt: 2 })], "a", { position: 505 })[0]).not.toHaveProperty("position");
  });
});

describe("needsDetails", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("always wants a title", () => {
    expect(needsDetails(video("a", { title: "", checkedAt: 100 }), 100)).toBe(true);
  });

  it("asks about unplayed videos once a day", () => {
    expect(needsDetails(video("a"), DAY)).toBe(true);
    expect(needsDetails(video("a", { checkedAt: DAY }), DAY + 1000)).toBe(false);
    expect(needsDetails(video("a", { checkedAt: DAY }), 2 * DAY)).toBe(true);
  });

  it("leaves videos with a position, and watched videos, alone", () => {
    expect(needsDetails(video("a", { position: 1 }), DAY)).toBe(false);
    expect(needsDetails(video("a", { watchedAt: 1 }), DAY)).toBe(false);
  });
});

describe("isFinished", () => {
  it("counts the last 10% of a video", () => {
    expect(isFinished(89, 100)).toBe(false);
    expect(isFinished(90, 100)).toBe(true);
  });

  it("allows at most two minutes from the end", () => {
    expect(isFinished(10_000 - 121, 10_000)).toBe(false);
    expect(isFinished(10_000 - 120, 10_000)).toBe(true);
  });
});

describe("applyProgress", () => {
  const sample = (position: number, duration = 100, ended = false) => ({ id: "a", position, duration, ended });

  it("records the position", () => {
    const [updated] = applyProgress([video("a", { duration: 100 })], sample(40), 5);
    expect(updated?.position).toBe(40);
    expect(updated?.watchedAt).toBeUndefined();
  });

  it("learns the duration if it wasn't known", () => {
    expect(applyProgress([video("a")], sample(40, 120), 5)[0]?.duration).toBe(120);
  });

  it("moves a finished video to Watched", () => {
    expect(applyProgress([video("a", { duration: 100 })], sample(95), 5)[0]?.watchedAt).toBe(5);
  });

  it("moves it when playback ended, wherever it thinks it is", () => {
    expect(applyProgress([video("a", { duration: 100 })], sample(50, 100, true), 5)[0]?.watchedAt).toBe(5);
  });

  describe("a video that's just joined the list", () => {
    const held = video("a", { duration: 100, finishHeld: true });

    it("isn't finished by being near the end", () => {
      const [updated] = applyProgress([held], sample(95), 5);
      expect(updated?.watchedAt).toBeUndefined();
      expect(updated?.position).toBe(95);
      expect(updated?.finishHeld).toBe(true);
    });

    it("is finished by reaching the very end", () => {
      expect(applyProgress([held], sample(100, 100, true), 5)[0]?.watchedAt).toBe(5);
    });

    it("finishes normally once it's been played from earlier on", () => {
      const played = applyProgress([held], sample(50), 5);
      expect(played[0]).not.toHaveProperty("finishHeld");
      expect(applyProgress(played, sample(95), 6)[0]?.watchedAt).toBe(6);
    });

    it("holds after Undo, and after being put back", () => {
      const list = markWatched([video("a", { duration: 100 })], "a", 5);
      expect(applyProgress(putBack(list, "a"), sample(95), 6)[0]?.watchedAt).toBeUndefined();
      expect(applyProgress(restoreVideo(list, video("a", { duration: 100 }), 0), sample(95), 6)[0]?.watchedAt).toBeUndefined();
    });
  });

  it("ignores reports whose length doesn't match, like an ad or the previous video", () => {
    const list = [video("a", { duration: 600 })];
    expect(applyProgress(list, sample(29, 30), 5)).toBe(list);
    expect(applyProgress(list, sample(30, 30, true), 5)).toBe(list);
  });

  it("allows for small differences in the reported length", () => {
    expect(applyProgress([video("a", { duration: 100 })], sample(40, 101.4), 5)[0]?.position).toBe(40);
  });

  it("ignores live streams and players that aren't ready", () => {
    const list = [video("a")];
    expect(applyProgress(list, sample(40, Infinity), 5)).toBe(list);
    expect(applyProgress(list, sample(0, Number.NaN), 5)).toBe(list);
  });

  it("ignores videos that aren't in the list or are already watched", () => {
    const list = [video("b"), video("a", { watchedAt: 2 })];
    expect(applyProgress(list, sample(40), 5)).toBe(list);
  });
});

describe("pruneWatched", () => {
  it("drops watched videos after the retention period, and nothing else", () => {
    const now = WATCHED_RETENTION_MS + 100;
    const list = [video("a"), video("old", { watchedAt: 50 }), video("recent", { watchedAt: 200 })];
    expect(pruneWatched(list, now).map((v) => v.id)).toEqual(["a", "recent"]);
  });
});

describe("resumeAt", () => {
  it("rewinds slightly", () => {
    expect(resumeAt(video("a", { position: 100.7 }))).toBe(97);
  });

  it("starts from the beginning if barely started, or already watched", () => {
    expect(resumeAt(video("a", { position: 8 }))).toBe(0);
    expect(resumeAt(video("a"))).toBe(0);
    expect(resumeAt(video("a", { position: 100, watchedAt: 1 }))).toBe(0);
  });
});

describe("progressOf", () => {
  it("is a share of the duration", () => {
    expect(progressOf(video("a", { position: 25, duration: 100 }))).toBe(0.25);
    expect(progressOf(video("a", { duration: 100 }))).toBe(0);
    expect(progressOf(video("a", { position: 25 }))).toBe(0);
  });
});
