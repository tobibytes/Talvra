import type { AssignmentDetail, DraftFile, HomeworkDraft } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  LoaderCircle,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ErrorState, ListSkeleton } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { dateTime, fileSize, relativeTime } from "@/lib/time";

const ONLINE = ["online_upload", "online_text_entry"];

/** "Do my homework": write the files to hand in, preview them, and (separately) submit them. */
export function DoHomeworkCard({ assignment }: { assignment: AssignmentDetail }) {
  const queryClient = useQueryClient();
  const key = ["homework", assignment.id, "draft"];
  const draft = useQuery({
    queryKey: key,
    queryFn: () => api.draft(assignment.id),
    // While the agent works (in the background), check in every few seconds.
    refetchInterval: (q) => (q.state.data?.draft?.status === "working" ? 4000 : false),
  });
  const [instructions, setInstructions] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  const instructionsId = React.useId();

  const write = useMutation({
    mutationFn: () => api.makeDraft(assignment.id, instructions.trim() || undefined),
    onSuccess: (res) => {
      queryClient.setQueryData(key, res);
      setInstructions("");
    },
    onError: (err) => toast.error(err.message),
  });
  const submit = useMutation({
    mutationFn: () => api.submitDraft(assignment.id),
    onSuccess: (res) => {
      queryClient.setQueryData(key, res);
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["homework"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      toast.success("Submitted to Canvas");
    },
    onError: (err) => toast.error(err.message),
  });

  const d = draft.data?.draft;
  const working = d?.status === "working";
  const canSubmit = assignment.submissionTypes.some((t) => ONLINE.includes(t));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Do my homework</h2>
        </CardTitle>
        <CardDescription>
          An AI works through the assignment like you would: it reads the files, runs the code,
          checks the results and looks things up on the web. Read its work before you submit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft.isPending ? (
          <ListSkeleton rows={2} />
        ) : draft.isError ? (
          <ErrorState error={draft.error} onRetry={() => draft.refetch()} />
        ) : write.isPending || working ? (
          <div className="space-y-1" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-medium">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {d?.progress ?? "Starting"}…
            </p>
            <p className="text-xs text-muted-foreground">
              This usually takes a few minutes. You can leave this page; it keeps going.
            </p>
          </div>
        ) : d ? (
          <>
            {d.status === "failed" ? (
              <Alert variant="destructive">
                <AlertTitle>That run didn't finish</AlertTitle>
                <AlertDescription>{d.error ?? "Something went wrong. Try again."}</AlertDescription>
              </Alert>
            ) : null}
            {d.files.length ? (
              <DraftView assignmentId={assignment.id} draft={d} htmlUrl={assignment.htmlUrl} />
            ) : null}
          </>
        ) : null}

        {!write.isPending && !working && !draft.isPending && !draft.isError ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              write.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor={instructionsId}>
                {d?.files.length ? "What should change?" : "Anything to know first? (optional)"}
              </FieldLabel>
              <Textarea
                id={instructionsId}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder={
                  d?.files.length
                    ? "e.g. Use seaborn for the plots"
                    : "e.g. Use Python, keep the report short"
                }
              />
              <FieldDescription>Optional. The AI follows these over its defaults.</FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant={d ? "outline" : "default"}>
                {d?.files.length ? <RefreshCw /> : <Sparkles />}
                {d?.files.length ? "Do it again" : "Do my homework"}
              </Button>
              {d && d.status === "ready" && canSubmit ? (
                <Button type="button" onClick={() => setConfirm(true)}>
                  <Send /> Submit to Canvas
                </Button>
              ) : null}
            </div>
            {d?.files.length && !canSubmit ? (
              <p className="text-xs text-muted-foreground">
                This assignment isn't submitted online. Download the files and hand them in the way
                your instructor asks.
              </p>
            ) : null}
          </form>
        ) : null}
      </CardContent>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit to Canvas?</DialogTitle>
            <DialogDescription>
              These files go to “{assignment.name}” in Canvas, submitted as you. Canvas keeps the
              submission; you can't undo it here.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {d?.files.map((f) => (
              <li key={f.name} className="flex items-center gap-2">
                <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{f.name}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Not yet
            </Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? <LoaderCircle className="animate-spin" /> : <Send />}
              Submit {d?.files.length === 1 ? "1 file" : `${d?.files.length ?? 0} files`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DraftView({
  assignmentId,
  draft,
  htmlUrl,
}: {
  assignmentId: string;
  draft: HomeworkDraft;
  htmlUrl: string | null;
}) {
  return (
    <div className="space-y-4">
      {draft.status === "submitted" && draft.submittedAt ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="success">
            <CircleCheck /> Submitted
          </Badge>
          <span className="text-muted-foreground" title={dateTime(draft.submittedAt)}>
            {relativeTime(draft.submittedAt)}
          </span>
          {htmlUrl ? (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              Check it in Canvas <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </p>
      ) : null}
      {draft.notes ? (
        <Alert>
          <AlertTitle>Before you submit</AlertTitle>
          <AlertDescription className="whitespace-pre-line">{draft.notes}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="divide-y rounded-lg border" aria-label="Files to hand in">
        {draft.files.map((f) => (
          <FileRow key={f.name} assignmentId={assignmentId} file={f} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Written {relativeTime(draft.updatedAt)}
        {draft.instructions ? ` · with your note: “${draft.instructions}”` : ""}
      </p>
    </div>
  );
}

/** How a file can be previewed in the page. */
function previewKind(f: DraftFile): "text" | "notebook" | null {
  if (f.name.toLowerCase().endsWith(".ipynb")) return "notebook";
  if (/^(text\/|application\/json)/.test(f.contentType)) return "text";
  return null;
}

type NotebookCell = {
  cell_type: string;
  source: string | string[];
  outputs?: {
    output_type: string;
    text?: string | string[];
    data?: Record<string, string | string[]>;
    ename?: string;
    evalue?: string;
  }[];
};

const joined = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join("") : (v ?? ""));

/** A read-only notebook view: markdown and code cells with their text, tables and plots. */
function NotebookPreview({ json }: { json: string }) {
  let cells: NotebookCell[] = [];
  try {
    cells = (JSON.parse(json) as { cells?: NotebookCell[] }).cells ?? [];
  } catch {
    return <p className="text-xs text-destructive">This notebook couldn't be read.</p>;
  }
  return (
    <div className="mt-2 max-h-[32rem] space-y-3 overflow-auto rounded-md border p-3">
      {cells.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: cells have no stable id here
        <div key={i} className="space-y-1">
          {c.cell_type === "markdown" ? (
            <pre className="whitespace-pre-wrap font-sans text-sm">{joined(c.source)}</pre>
          ) : (
            <>
              <pre className="overflow-auto rounded bg-muted p-2 text-xs leading-5">
                {joined(c.source)}
              </pre>
              {(c.outputs ?? []).map((o, j) => {
                const png = o.data?.["image/png"];
                const text = o.text ?? o.data?.["text/plain"];
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: outputs have no id
                  <div key={j} className="text-xs">
                    {png ? (
                      <img
                        src={`data:image/png;base64,${joined(png).replace(/\s/g, "")}`}
                        alt={`Output of cell ${i + 1}`}
                        className="max-w-full rounded border bg-white"
                      />
                    ) : o.output_type === "error" ? (
                      <pre className="whitespace-pre-wrap text-destructive">
                        {o.ename}: {o.evalue}
                      </pre>
                    ) : text ? (
                      <pre className="overflow-auto whitespace-pre text-muted-foreground">
                        {joined(text)}
                      </pre>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function FileRow({ assignmentId, file }: { assignmentId: string; file: DraftFile }) {
  const [open, setOpen] = React.useState(false);
  const url = api.draftFileUrl(assignmentId, file.name);
  const kind = previewKind(file);
  const text = useQuery({
    queryKey: ["homework", assignmentId, "draft-file", file.name, file.size],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Couldn't load this file.");
      return res.text();
    },
    enabled: open && kind !== null,
  });
  return (
    <li className="p-3">
      <div className="flex items-center gap-3">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">{fileSize(file.size)}</p>
        </div>
        {kind ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Preview"} ${file.name}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <EyeOff /> : <Eye />}
            <span className="hidden sm:inline">{open ? "Hide" : "Preview"}</span>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          render={<a href={url} download={file.name} aria-label={`Download ${file.name}`} />}
        >
          <Download />
          <span className="hidden sm:inline">Download</span>
        </Button>
      </div>
      {open ? (
        text.isPending ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
        ) : text.isError ? (
          <p className="mt-2 text-xs text-destructive">{text.error.message}</p>
        ) : kind === "notebook" ? (
          <NotebookPreview json={text.data} />
        ) : (
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
            {text.data}
          </pre>
        )
      ) : null}
    </li>
  );
}
