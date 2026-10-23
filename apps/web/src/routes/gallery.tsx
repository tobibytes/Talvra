import { createFileRoute } from "@tanstack/react-router";
import { Bell, FileText, Inbox, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/gallery")({ component: Gallery });

const reminderOptions = [
  { value: "3d", label: "3 days before" },
  { value: "1d", label: "1 day before" },
  { value: "3h", label: "3 hours before" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`g-${title}`} className="space-y-3">
      <h2
        id={`g-${title}`}
        className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {title}
      </h2>
      <div className="rounded-xl border bg-card p-5">{children}</div>
    </section>
  );
}

function Gallery() {
  const [deleted, setDeleted] = React.useState(false);

  const deleteWithUndo = () => {
    setDeleted(true);
    toast("Flashcard deck deleted", {
      action: { label: "Undo", onClick: () => setDeleted(false) },
    });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Component gallery"
        description="Every building block, in the current theme. Switch themes from the top bar or ⌘K."
      />

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">
            <Plus /> Small
          </Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Notifications">
            <Bell />
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="success">Ready</Badge>
          <Badge variant="warning">Due tomorrow</Badge>
          <Badge variant="destructive">Failed</Badge>
          <Badge variant="outline">COSC 220</Badge>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-6 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="g-email">Morgan email</FieldLabel>
            <Input id="g-email" type="email" placeholder="you@morgan.edu" />
            <FieldDescription>Only @morgan.edu addresses can sign in.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="g-notes">Notes</FieldLabel>
            <Textarea id="g-notes" placeholder="What do you want to focus on?" />
          </Field>
          <Field>
            <FieldLabel>Remind me</FieldLabel>
            <Select items={reminderOptions} defaultValue="1d">
              <SelectTrigger className="w-full" aria-label="Remind me">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reminderOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="space-y-4">
            <Field orientation="horizontal">
              <Switch id="g-digest" defaultChecked />
              <FieldLabel htmlFor="g-digest">Weekly digest email</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="g-quiet" />
              <FieldLabel htmlFor="g-quiet">Quiet hours (10pm to 8am)</FieldLabel>
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="read">
          <TabsList>
            <TabsTrigger value="read">Read</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="flashcards">Flashcards</TabsTrigger>
          </TabsList>
          <TabsContent value="read" className="pt-3 text-sm text-muted-foreground">
            The extracted document, rendered as markdown.
          </TabsContent>
          <TabsContent value="notes" className="pt-3 text-sm text-muted-foreground">
            AI notes with citations back to the source.
          </TabsContent>
          <TabsContent value="flashcards" className="pt-3 text-sm text-muted-foreground">
            Spaced-repetition review.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Regenerate notes?</DialogTitle>
                <DialogDescription>
                  The current version stays in the history, so you can switch back.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <DialogClose render={<Button />}>Regenerate</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              Open menu
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <FileText /> Open document
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Inbox /> Move to module
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>Hover or focus me</TooltipTrigger>
            <TooltipContent>
              Tooltips work with the keyboard too <Kbd>Esc</Kbd>
            </TooltipContent>
          </Tooltip>

          <Button variant="outline" onClick={() => toast.success("Notes saved")}>
            Show toast
          </Button>
          <Button variant="destructive" onClick={deleteWithUndo} disabled={deleted}>
            <Trash2 /> {deleted ? "Deleted" : "Delete with undo"}
          </Button>
        </div>
      </Section>

      <Section title="Feedback">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm">Syncing COSC 220 · 7 of 12 files</p>
            <Progress value={58} aria-label="Sync progress" />
          </div>
          <Alert>
            <Bell />
            <AlertTitle>Lab 3 is due tomorrow at 11:59 PM</AlertTitle>
            <AlertDescription>Your plan has 2 steps left, about 90 minutes.</AlertDescription>
          </Alert>
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>OO</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Card">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Week 6 Lecture: Trees</CardTitle>
            <CardDescription>COSC 220 · PDF · 24 pages</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Badge variant="success">Ready</Badge>
            <Badge variant="outline">Notes</Badge>
            <Badge variant="outline">Flashcards</Badge>
          </CardContent>
        </Card>
      </Section>

      <Section title="Page states">
        <div className="space-y-6">
          <ListSkeleton rows={2} />
          <EmptyState
            icon={Inbox}
            title="No files in this module"
            description="Files your instructor adds in Canvas show up after the next sync."
          />
          <ErrorState
            error={
              new ApiRequestError(500, {
                error: {
                  code: "internal",
                  message: "Something went wrong on our side.",
                  requestId: "req_example",
                },
              })
            }
            onRetry={() => toast("Retrying…")}
          />
        </div>
      </Section>
    </div>
  );
}
