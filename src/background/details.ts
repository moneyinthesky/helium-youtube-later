// Looks up a video's details from nothing but its ID, so saving doesn't depend
// on the layout of YouTube's pages.
import { applyMetadata, needsDetails, type Video } from "../core/videos";
import { oembedUrl, parseLengthSeconds, parseResumeSeconds, watchUrl } from "../core/youtube";
import { updateVideos } from "./store";

async function fetchOembed(id: string): Promise<{ title?: string; channel?: string }> {
  const response = await fetch(oembedUrl(id), { credentials: "omit" });
  if (!response.ok) return {};
  const { title, author_name } = (await response.json()) as { title?: string; author_name?: string };
  return { title, channel: author_name };
}

async function fetchWatchPage(id: string): Promise<{ duration?: number; position?: number; checkedAt?: number }> {
  // With cookies: being signed in is what makes the page say where you'd got to.
  const response = await fetch(watchUrl(id), { credentials: "include" });
  if (!response.ok) return {};
  const html = await response.text();
  return {
    duration: parseLengthSeconds(html, id) ?? undefined,
    position: parseResumeSeconds(html) ?? undefined,
    checkedAt: Date.now(),
  };
}

/** Fills in what it can. Failures leave the video as it is, to try again when the panel next opens. */
export async function fillDetails(id: string): Promise<void> {
  const [oembed, watchPage] = await Promise.all([
    fetchOembed(id).catch(() => ({})),
    fetchWatchPage(id).catch(() => ({})),
  ]);
  await updateVideos((videos) => ({ videos: applyMetadata(videos, id, { ...oembed, ...watchPage }) }));
}

/** One at a time: each watch page is over a megabyte, and there's no hurry. */
export async function fillMissingDetails(videos: Video[]): Promise<void> {
  const now = Date.now();
  for (const video of videos.filter((v) => needsDetails(v, now))) await fillDetails(video.id);
}
