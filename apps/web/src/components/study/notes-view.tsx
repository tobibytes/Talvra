import type { Anchor, StudyNotes } from "@talvra/contracts";
import { Cites } from "./cite";

export function NotesView({
  notes,
  documentId,
  slugFor,
}: {
  notes: StudyNotes;
  documentId: string;
  slugFor: (a: Anchor) => string | null;
}) {
  return (
    <article className="space-y-6 rounded-xl border bg-card p-5 sm:p-8" aria-label="Study notes">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">{notes.title}</h2>
        <p className="leading-7 text-muted-foreground">{notes.summary}</p>
      </header>
      {notes.sections.map((s) => (
        <section key={s.heading} className="space-y-2">
          <h3 className="font-semibold">{s.heading}</h3>
          <ul className="list-disc space-y-1.5 ps-6">
            {s.bullets.map((b) => (
              <li key={b.text} className="leading-7">
                {b.text}
                <Cites documentId={documentId} cite={b.cite} slugFor={slugFor} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {notes.keyTerms.length ? (
        <section className="space-y-2">
          <h3 className="font-semibold">Key terms</h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            {notes.keyTerms.map((t) => (
              <div key={t.term} className="rounded-lg border bg-muted/30 p-3">
                <dt className="font-medium">{t.term}</dt>
                <dd className="text-sm text-muted-foreground">
                  {t.definition}
                  <Cites documentId={documentId} cite={t.cite} slugFor={slugFor} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  );
}
