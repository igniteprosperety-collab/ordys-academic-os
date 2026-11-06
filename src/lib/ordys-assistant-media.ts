export type OrdysAttachmentKind = "image" | "file" | "video";

export type OrdysAttachment = {
  id: string;
  name: string;
  kind: OrdysAttachmentKind;
  mimeType: string;
  size: number;
  dataUrl?: string;
  frames?: string[];
  durationSeconds?: number;
};

const MAX_FILES = 6;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_PAYLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;
const MAX_VIDEO_FRAMES = 6;
const MAX_VIDEO_EDGE = 960;

const SUPPORTED_FILE_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isVideo(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(file.name);
}

function videoMimeType(file: File) {
  const declaredMime = file.type.trim().toLowerCase();
  if (declaredMime && declaredMime !== "application/octet-stream") return declaredMime;
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const inferred: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
  };
  return inferred[extension] ?? (declaredMime || "application/octet-stream");
}

function isImage(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name);
}

function isSupportedFile(file: File) {
  return SUPPORTED_FILE_MIME.has(file.type) || /\.(pdf|txt|md|csv|json|doc|docx|ppt|pptx|xls|xlsx)$/i.test(file.name);
}

function bytesOf(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.ceil((base64.length * 3) / 4);
}

async function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    if ("createImageBitmap" in window) return await createImageBitmap(file);
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitSize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function encodeCanvas(source: CanvasImageSource, width: number, height: number, quality = 0.82) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Seu dispositivo não conseguiu preparar a imagem.");
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function prepareImage(file: File): Promise<OrdysAttachment> {
  const image = await loadImage(file);
  const { width, height } = fitSize(image.width, image.height, MAX_IMAGE_EDGE);
  const dataUrl = await encodeCanvas(image, width, height);
  if ("close" in image && typeof image.close === "function") image.close();
  return { id: uid(), name: file.name, kind: "image", mimeType: "image/jpeg", size: file.size, dataUrl };
}

async function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= 1) return;
  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Não foi possível ler este vídeo neste dispositivo.")); };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
  });
}

async function seek(video: HTMLVideoElement, time: number) {
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Não foi possível extrair um quadro do vídeo.")); };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

async function prepareVideo(file: File): Promise<OrdysAttachment> {
  const [rawDataUrl, url] = await Promise.all([readDataUrl(file), Promise.resolve(URL.createObjectURL(file))]);
  const mimeType = videoMimeType(file);
  // FileReader may label files with an empty browser MIME as application/octet-stream.
  // Keep the data URL metadata aligned with the extension-derived MIME used downstream.
  const dataUrl = rawDataUrl.replace(/^data:[^;,]+/, `data:${mimeType}`);
  const video = document.createElement("video");
  video.src = url;
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  try {
    await waitForVideoMetadata(video);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || duration <= 0) throw new Error(`Não foi possível determinar a duração de ${file.name}.`);

    const frameCount = Math.min(MAX_VIDEO_FRAMES, Math.max(3, Math.ceil(duration / 30)));
    const frames: string[] = [];
    for (let index = 0; index < frameCount; index += 1) {
      const ratio = frameCount === 1 ? 0.5 : index / (frameCount - 1);
      const safeTime = Math.min(duration - 0.05, Math.max(0, duration * ratio));
      await seek(video, safeTime);
      const { width, height } = fitSize(video.videoWidth || 1280, video.videoHeight || 720, MAX_VIDEO_EDGE);
      frames.push(await encodeCanvas(video, width, height, 0.72));
    }
    return { id: uid(), name: file.name, kind: "video", mimeType, size: file.size, dataUrl, frames, durationSeconds: Math.round(duration * 10) / 10 };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function prepareFile(file: File): Promise<OrdysAttachment> {
  if (isImage(file)) return prepareImage(file);
  if (isVideo(file)) return prepareVideo(file);
  if (!isSupportedFile(file)) throw new Error(`${file.name}: formato não suportado pelo Assistente Ordys.`);
  const dataUrl = await readDataUrl(file);
  return { id: uid(), name: file.name, kind: "file", mimeType: file.type || "application/octet-stream", size: file.size, dataUrl };
}

export async function prepareOrdysAttachments(files: FileList | File[]) {
  const selected = Array.from(files).slice(0, MAX_FILES);
  if (!selected.length) return [];
  if (Array.from(files).length > MAX_FILES) throw new Error(`O Ordys aceita até ${MAX_FILES} anexos por mensagem.`);
  for (const file of selected) {
    const limit = isVideo(file) ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) throw new Error(`${file.name}: limite de ${isVideo(file) ? 24 : 8} MB para este tipo de arquivo.`);
  }

  const attachments: OrdysAttachment[] = [];
  let payloadBytes = 0;
  for (const file of selected) {
    const attachment = await prepareFile(file);
    const preparedBytes = attachment.dataUrl ? bytesOf(attachment.dataUrl) : (attachment.frames ?? []).reduce((sum, frame) => sum + bytesOf(frame), 0);
    if (attachment.kind !== "video") payloadBytes += preparedBytes;
    else payloadBytes += (attachment.frames ?? []).reduce((sum, frame) => sum + bytesOf(frame), 0);
    if (payloadBytes > MAX_TOTAL_PAYLOAD_BYTES) throw new Error("Os anexos visuais ficaram grandes demais para uma única mensagem. Reduza a quantidade ou a qualidade do material enviado.");
    attachments.push(attachment);
  }
  return attachments;
}

export const ORDYS_ATTACHMENT_LIMITS = { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, maxVideoBytes: MAX_VIDEO_BYTES };
