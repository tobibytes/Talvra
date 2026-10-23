import { SUPPORTED_EXTENSIONS } from "@talvra/contracts";

/** R2 layout: everything for a document lives under its owner's prefix. */
export const fileKeys = (userId: string, documentId: string) => {
  const base = `u/${userId}/d/${documentId}`;
  return {
    prefix: `${base}/`,
    original: `${base}/original`,
    markdown: `${base}/content.md`,
    structure: `${base}/structure.json`,
  };
};

/** Canvas downloads are held in memory once in the Worker (128 MB limit). */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

const SUPPORTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/html",
  "text/plain",
  "text/markdown",
];

/** Whether the extractor can read this file, by extension or MIME type. */
export function isSupported(title: string, mimeType: string | null) {
  const name = title.toLowerCase();
  if (SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  const mime = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return SUPPORTED_MIME.includes(mime);
}

export async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A filename safe for Content-Disposition (ASCII fallback + RFC 5987 UTF-8). */
export function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  html: "text/plain; charset=utf-8",
  htm: "text/plain; charset=utf-8",
};

/** Content-Type for serving a stored original: from the extension, never the client's claim. */
export function servedMime(title: string) {
  const ext = title.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
