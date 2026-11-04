// Everything that knows the shape of YouTube's URLs and pages.

/** In the e2e build the local test server stands in for YouTube. Its port is fixed so it can be built in. */
export const E2E_ORIGIN = "http://127.0.0.1:47821";

export const YOUTUBE_ORIGIN = __E2E__ ? E2E_ORIGIN : "https://www.youtube.com";

/** Match patterns for tabs showing YouTube. Leaves out music.youtube.com, which is a different app. */
export const YOUTUBE_TAB_PATTERNS = __E2E__
  ? ["http://127.0.0.1/*"]
  : ["https://www.youtube.com/*", "https://m.youtube.com/*"];

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const PATH_PREFIXES = new Set(["shorts", "live", "embed", "v"]);

export const isVideoId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{11}$/.test(id);

/** The video a URL points at, or null if it isn't a link to a single video. */
export function parseVideoId(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const [first, second] = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined;
  if (url.hostname === "youtu.be") {
    id = first;
  } else if (YOUTUBE_HOSTS.has(url.hostname) || (__E2E__ && url.origin === E2E_ORIGIN)) {
    if (first === "watch") id = url.searchParams.get("v");
    else if (first && PATH_PREFIXES.has(first)) id = second;
  }
  return isVideoId(id) ? id : null;
}

export function watchUrl(id: string, startSeconds = 0): string {
  return `${YOUTUBE_ORIGIN}/watch?v=${id}${startSeconds > 0 ? `&t=${startSeconds}s` : ""}`;
}

export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

export const oembedUrl = (id: string) =>
  `${YOUTUBE_ORIGIN}/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;

/**
 * The video's length, from the player data embedded in its watch page. oEmbed
 * doesn't give it. Null if the page has none, or says 0, as live streams do.
 */
export function parseLengthSeconds(html: string, id: string): number | null {
  const match = new RegExp(`"videoDetails":\\{"videoId":"${id}".{0,4000}?"lengthSeconds":"(\\d+)"`).exec(html);
  const seconds = Number(match?.[1]);
  return seconds > 0 ? seconds : null;
}

/**
 * Where YouTube would resume this video for you, from the same page. It's only
 * there if the page was fetched signed in, and you've watched part of the video.
 */
export function parseResumeSeconds(html: string): number | null {
  const seconds = Number(/"playbackStartConfig":\{"startSeconds":(\d+)/.exec(html)?.[1]);
  return seconds > 0 ? seconds : null;
}
