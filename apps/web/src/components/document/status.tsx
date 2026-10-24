import type { DocumentStatus } from "@talvra/contracts";
import { StatusPill } from "@/components/blocks";

export const statusText: Record<DocumentStatus, string> = {
  pending: "Waiting",
  downloading: "Downloading",
  extracting: "Reading",
  ready: "Ready",
  failed: "Failed",
  unsupported: "Can't read",
};

export const isProcessing = (s: DocumentStatus) =>
  s === "pending" || s === "downloading" || s === "extracting";

/** Dot + word: ready is ok, failed is stop, in progress uses the accent. */
export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const tone =
    status === "ready"
      ? "ok"
      : status === "failed"
        ? "stop"
        : status === "unsupported"
          ? "neutral"
          : "accent";
  return <StatusPill tone={tone}>{statusText[status]}</StatusPill>;
}
