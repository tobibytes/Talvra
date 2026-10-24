import { MAX_UPLOAD_BYTES, SUPPORTED_EXTENSIONS } from "@talvra/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileUp, LoaderCircle, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { fileSize } from "@/lib/time";
import { cn } from "@/lib/utils";

function problemWith(file: File) {
  const name = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `Talvra reads ${SUPPORTED_EXTENSIONS.filter((e) => e !== ".htm").join(", ")} files.`;
  }
  if (file.size > MAX_UPLOAD_BYTES)
    return `That file is ${fileSize(file.size)}; the limit is 40 MB.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** "Upload" button + dialog with a drop zone. Opens the document once uploaded. */
export function UploadButton({
  courseId,
  variant = "outline",
}: {
  courseId?: string;
  variant?: "outline" | "default";
}) {
  const [open, setOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputId = React.useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadDocument(file, courseId),
    onSuccess: async (doc) => {
      setOpen(false);
      toast.success(`Uploaded ${doc.title}`);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (courseId) void queryClient.invalidateQueries({ queryKey: ["course", courseId] });
      await navigate({ to: "/documents/$documentId", params: { documentId: doc.id } });
    },
    onError: (err) => setProblem(err.message),
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    const p = problemWith(file);
    setProblem(p);
    if (!p) upload.mutate(file);
  };

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Upload /> Upload
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setProblem(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload study material</DialogTitle>
            <DialogDescription>
              Notes, slides or readings that aren't in Canvas. Only you can see them.
            </DialogDescription>
          </DialogHeader>
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
              "focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-muted/50",
              dragging && "border-primary bg-primary/5",
            )}
          >
            {upload.isPending ? (
              <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden />
            ) : (
              <FileUp className="size-8 text-muted-foreground" aria-hidden />
            )}
            <span className="font-medium">
              {upload.isPending ? "Uploading…" : "Drop a file here, or click to choose"}
            </span>
            <span className="text-sm text-muted-foreground">
              PDF, Word, PowerPoint, Markdown, text or HTML · up to 40 MB
            </span>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              className="sr-only"
              accept={SUPPORTED_EXTENSIONS.join(",")}
              disabled={upload.isPending}
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {problem ? (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
