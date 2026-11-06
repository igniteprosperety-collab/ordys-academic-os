import type { OrdysAttachment } from "@/lib/ordys-assistant-media";

const SUPPORTED_VIDEO_AUDIO_FORMATS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/**
 * The transcription endpoint accepts audio-bearing MP4/WebM containers only.
 * Other video formats may still be analyzed visually through extracted frames.
 */
export function isOrdysVideoAudioTranscriptionSupported(
  attachment: Pick<OrdysAttachment, "kind" | "mimeType" | "name">,
) {
  if (attachment.kind !== "video") return false;
  const mimeType = attachment.mimeType.trim().toLowerCase();
  const expectedExtension = SUPPORTED_VIDEO_AUDIO_FORMATS[mimeType];
  if (!expectedExtension) return false;
  const actualExtension = attachment.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return actualExtension === expectedExtension;
}
