import type { DocumentStatus } from "@talvra/contracts";
import { LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const variant =
    status === "ready"
      ? "success"
      : status === "failed"
        ? "destructive"
        : status === "unsupported"
          ? "secondary"
          : "outline";
  return (
    <Badge variant={variant}>
      {isProcessing(status) && status !== "pending" ? (
        <LoaderCircle className="animate-spin" aria-hidden />
      ) : null}
      {statusText[status]}
    </Badge>
  );
}
