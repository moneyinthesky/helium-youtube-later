import type { ProgressSample, Video } from "./videos";

/** From the side panel to the service worker. */
export type PanelMessage =
  | { type: "open"; id: string; windowId: number }
  | { type: "remove"; id: string }
  | { type: "mark-watched"; id: string }
  | { type: "put-back"; id: string }
  | { type: "restore"; video: Video; index: number }
  | { type: "import"; videos: Video[] }
  | { type: "refresh-details" };

/** From the YouTube page to the service worker. */
export type ContentMessage = { type: "progress"; sample: ProgressSample };

/** From the service worker to the YouTube page. */
export type TabMessage = { type: "get-target" } | { type: "toast"; text: string; videoId?: string };

/** The reply to get-target. */
export type TargetReply = { id: string | null };
