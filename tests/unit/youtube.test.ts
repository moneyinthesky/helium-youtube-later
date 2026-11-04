import { describe, expect, it } from "vitest";
import { parseLengthSeconds, parseResumeSeconds, parseVideoId, watchUrl } from "../../src/core/youtube";

const ID = "aqz-KE-bpKQ";

describe("parseVideoId", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/watch?v=${ID}&list=PL123&t=30s`],
    [`https://www.youtube.com/watch?list=PL123&v=${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/live/${ID}?feature=share`],
    [`https://www.youtube.com/embed/${ID}`],
  ])("finds the video in %s", (url) => {
    expect(parseVideoId(url)).toBe(ID);
  });

  it.each([
    ["https://www.youtube.com/"],
    ["https://www.youtube.com/@BlenderOfficial"],
    ["https://www.youtube.com/playlist?list=PL123"],
    ["https://www.youtube.com/watch"],
    ["https://www.youtube.com/watch?v=short"],
    [`https://www.youtube.com/watch?v=${ID}%22%3E`],
    [`https://notyoutube.com/watch?v=${ID}`],
    [`https://example.com/shorts/${ID}`],
    ["not a url"],
  ])("finds nothing in %s", (url) => {
    expect(parseVideoId(url)).toBeNull();
  });
});

describe("watchUrl", () => {
  it("adds a start time only when there is one", () => {
    expect(watchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(watchUrl(ID, 90)).toBe(`https://www.youtube.com/watch?v=${ID}&t=90s`);
  });
});

describe("parseResumeSeconds", () => {
  it("reads where YouTube would resume", () => {
    const html = `"playerConfig":{"playbackStartConfig":{"startSeconds":505,"startPosition":{"streamTimeMillis":"505000"}}}`;
    expect(parseResumeSeconds(html)).toBe(505);
  });

  it("finds nothing on a page for someone who hasn't started it", () => {
    expect(parseResumeSeconds(`"playerConfig":{"audioConfig":{}}`)).toBeNull();
    expect(parseResumeSeconds(`"playbackStartConfig":{"startSeconds":0}`)).toBeNull();
  });
});

describe("parseLengthSeconds", () => {
  const page = (id: string, seconds: string) =>
    `var x = {"videoDetails":{"videoId":"${id}","title":"A {braced} title","lengthSeconds":"${seconds}","keywords":[]}};`;

  it("reads the length of this video", () => {
    expect(parseLengthSeconds(page(ID, "635"), ID)).toBe(635);
  });

  it("ignores other videos on the page", () => {
    expect(parseLengthSeconds(page("xxxxxxxxxxx", "99"), ID)).toBeNull();
  });

  it("treats a live stream's 0 as unknown", () => {
    expect(parseLengthSeconds(page(ID, "0"), ID)).toBeNull();
  });

  it("copes with a page that has no player data", () => {
    expect(parseLengthSeconds("<html>Before you continue</html>", ID)).toBeNull();
  });
});
