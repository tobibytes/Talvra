import type { AssignmentDetail, DraftFile, HomeworkDraft } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/document/markdown";
import {
  CircleCheck,
  ClipboardCheck,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  LoaderCircle,
  Pencil,
  Send,
  Sparkles,
} from "@/components/icons";
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
import { Input } from "@/components/ui/input";
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
    refetchInterval: (q) =>
      ["working", "submitting"].includes(q.state.data?.draft?.status ?? "") ? 4000 : false,
  });
  const [instructions, setInstructions] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  const [renaming, setRenaming] = React.useState<DraftFile | null>(null);
  const [newName, setNewName] = React.useState("");
  const instructionsId = React.useId();
  const nameId = React.useId();
  const d = draft.data?.draft;
  const conversation = React.useRef<HTMLDivElement>(null);
  const messageCount = d?.messages.length ?? 0;
  React.useEffect(() => {
    if (messageCount && conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [messageCount]);
  const hasFiles = Boolean(d?.files.length);
  const accept = (res: { draft: HomeworkDraft | null }) => {
    queryClient.setQueryData(key, res);
    void queryClient.invalidateQueries({ queryKey: ["homework", assignment.id, "draft-file"] });
  };
  const write = useMutation({
    mutationFn: () =>
      hasFiles
        ? api.followUpDraft(assignment.id, instructions.trim())
        : api.makeDraft(assignment.id, instructions.trim() || undefined),
    onSuccess: (res) => {
      accept(res);
      setInstructions("");
    },
    onError: (err) => toast.error(err.message),
  });
  const verify = useMutation({
    mutationFn: () => api.verifyDraft(assignment.id),
    onSuccess: accept,
    onError: (err) => toast.error(err.message),
  });
  const rename = useMutation({
    mutationFn: () => api.renameDraftFile(assignment.id, renaming?.name ?? "", newName.trim()),
    onSuccess: (res) => {
      accept(res);
      setRenaming(null);
      toast.success("File renamed");
    },
    onError: (err) => toast.error(err.message),
  });
  const submit = useMutation({
    mutationFn: () => api.submitDraft(assignment.id, d?.updatedAt),
    onSuccess: (res) => {
      accept(res);
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["homework"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      toast.success("Submitted to Canvas");
    },
    onError: (err) => toast.error(err.message),
  });
  const busy =
    write.isPending ||
    verify.isPending ||
    rename.isPending ||
    submit.isPending ||
    d?.status === "working" ||
    d?.status === "submitting";
  const canSubmit = assignment.submissionTypes.some((t) => ONLINE.includes(t));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Do my homework</h2>
        </CardTitle>
        <CardDescription>Make the files, refine them, then submit to Canvas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft.isPending ? (
          <ListSkeleton rows={2} />
        ) : draft.isError ? (
          <ErrorState error={draft.error} onRetry={() => draft.refetch()} />
        ) : (
          <>
            {d?.error ? (
              <Alert variant="destructive">
                <AlertTitle>That request didn't finish</AlertTitle>
                <AlertDescription>{d.error}</AlertDescription>
              </Alert>
            ) : null}
            {hasFiles && d ? (
              <DraftView
                assignmentId={assignment.id}
                draft={d}
                htmlUrl={assignment.htmlUrl}
                disabled={busy}
                onRename={(f) => {
                  setRenaming(f);
                  setNewName(f.name);
                }}
              />
            ) : null}
            {d?.messages.length ? (
              <div
                ref={conversation}
                role="log"
                aria-label="Homework conversation"
                className="max-h-80 space-y-3 overflow-auto rounded-lg border p-3"
              >
                {d.messages.map((m) => (
                  <div key={m.id} className={m.role === "user" ? "rounded-md bg-muted p-3" : "p-1"}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {m.role === "user" ? "You" : "Talvra"}
                    </p>
                    {m.role === "user" ? (
                      <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>
                    ) : (
                      <Markdown compact>{m.text}</Markdown>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
            {d?.verification ? (
              <section className="space-y-3 rounded-lg border p-4" aria-label="Verification report">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="size-4" />
                  <h3 className="text-sm font-medium">Verification report</h3>
                </div>
                <Markdown compact>{d.verification.summary}</Markdown>
                <ul className="space-y-3">
                  {d.verification.checks.map((check, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: immutable report checks have no ids
                    <li key={`${i}-${check.name}`} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{check.name}</span>
                        <Badge variant={check.status === "passed" ? "success" : "outline"}>
                          {check.status === "passed"
                            ? "Passed"
                            : check.status === "issue"
                              ? "Issue found"
                              : "Not checked"}
                        </Badge>
                      </div>
                      <Markdown compact className="mt-1 text-muted-foreground">
                        {check.detail}
                      </Markdown>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Checked {relativeTime(d.verification.checkedAt)}, for these files.
                </p>
              </section>
            ) : null}
            {busy ? (
              <div role="status" aria-live="polite" className="space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {d?.status === "submitting" || submit.isPending
                    ? "Submitting to Canvas"
                    : verify.isPending
                      ? "Starting verification"
                      : rename.isPending
                        ? "Renaming file"
                        : (d?.progress ?? "Starting")}
                  …
                </p>
                {d?.status === "working" ? (
                  <p className="text-xs text-muted-foreground">It keeps going if you leave.</p>
                ) : null}
              </div>
            ) : null}
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) write.mutate();
              }}
            >
              <Field>
                <FieldLabel htmlFor={instructionsId}>
                  {hasFiles ? "Message the homework agent" : "Anything to know first? (optional)"}
                </FieldLabel>
                <Textarea
                  id={instructionsId}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={4000}
                  rows={3}
                  disabled={busy}
                  placeholder={
                    hasFiles
                      ? "e.g. Explain question 3, add a conclusion, or use seaborn for the plots"
                      : "e.g. Use Python, keep the report short"
                  }
                />
                {hasFiles ? (
                  <FieldDescription>Changes replace the draft when done.</FieldDescription>
                ) : null}
              </Field>
              <Button
                type="submit"
                variant={hasFiles ? "outline" : "default"}
                disabled={busy || (hasFiles && !instructions.trim())}
              >
                {hasFiles ? <Send /> : <Sparkles />}
                {hasFiles ? "Send follow-up" : "Do my homework"}
              </Button>
            </form>
            {hasFiles ? (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => verify.mutate()}
                >
                  <ClipboardCheck />
                  {d?.verification ? "Verify again" : "Verify work"}
                </Button>
                {canSubmit ? (
                  <Button
                    type="button"
                    disabled={busy || d?.status !== "ready"}
                    onClick={() => setConfirm(true)}
                  >
                    <Send />
                    {d?.status === "submitted" ? "Submitted to Canvas" : "Submit to Canvas"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Not submitted online. Download the files instead.
                  </p>
                )}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit to Canvas?</DialogTitle>
            <DialogDescription>
              These files go to “{assignment.name}” in Canvas, submitted as you.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {d?.files.map((f) => (
              <li key={f.name} className="break-words">
                {f.name}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={submit.isPending}>
              Not yet
            </Button>
            <Button onClick={() => submit.mutate()} disabled={busy || d?.status !== "ready"}>
              {submit.isPending ? <LoaderCircle className="animate-spin" /> : <Send />}Submit{" "}
              {d?.files.length === 1 ? "1 file" : `${d?.files.length ?? 0} files`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(renaming)}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>Keep the extension.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) rename.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor={nameId}>File name</FieldLabel>
              <Input
                id={nameId}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                disabled={rename.isPending}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !newName.trim()}>
                {rename.isPending ? "Saving…" : "Save name"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DraftView({
  assignmentId,
  draft,
  htmlUrl,
  disabled,
  onRename,
}: {
  assignmentId: string;
  draft: HomeworkDraft;
  htmlUrl: string | null;
  disabled: boolean;
  onRename: (file: DraftFile) => void;
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
      {draft.notes && !draft.messages.length ? (
        <Alert>
          <AlertTitle>Before you submit</AlertTitle>
          <AlertDescription>
            <Markdown compact>{draft.notes}</Markdown>
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="divide-y rounded-lg border" aria-label="Files to hand in">
        {draft.files.map((f) => (
          <FileRow
            key={`${f.name}-${draft.updatedAt}`}
            assignmentId={assignmentId}
            file={f}
            version={draft.updatedAt}
            disabled={disabled}
            onRename={() => onRename(f)}
          />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Updated {relativeTime(draft.updatedAt)}
        {draft.instructions ? (
          <span className="block">Your note: “{draft.instructions}”</span>
        ) : null}
      </p>
    </div>
  );
}

/** How a file can be previewed in the page. */
function previewKind(f: DraftFile): "text" | "markdown" | "notebook" | null {
  const name = f.name.toLowerCase();
  if (name.endsWith(".ipynb")) return "notebook";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
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
            <Markdown compact>{joined(c.source)}</Markdown>
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

function FileRow({
  assignmentId,
  file,
  version,
  disabled,
  onRename,
}: {
  assignmentId: string;
  file: DraftFile;
  version: string;
  disabled: boolean;
  onRename: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const url = api.draftFileUrl(assignmentId, file.name);
  const kind = previewKind(file);
  const text = useQuery({
    queryKey: ["homework", assignmentId, "draft-file", file.name, version],
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
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Rename ${file.name}`}
          disabled={disabled}
          onClick={onRename}
        >
          <Pencil />
          <span className="hidden sm:inline">Rename</span>
        </Button>
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
        ) : kind === "markdown" ? (
          <Markdown compact className="mt-2 max-h-96 overflow-auto rounded-md border p-3">
            {text.data}
          </Markdown>
        ) : (
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
            {text.data}
          </pre>
        )
      ) : null}
    </li>
  );
}
