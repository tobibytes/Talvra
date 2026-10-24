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
    <article className="space-y-7 rounded-2xl border bg-card p-5 sm:p-10" aria-label="Study notes">
      <header className="mx-auto max-w-[68ch] space-y-3">
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{notes.title}</h2>
        <p className="text-lg leading-relaxed text-soft">{notes.summary}</p>
      </header>
      {notes.sections.map((s, i) => (
        <section key={s.heading} className="mx-auto max-w-[68ch] space-y-2.5">
          <h3 className="flex items-baseline gap-3 text-lg font-bold">
            <span aria-hidden className="font-mono text-xs font-normal text-primary" data-numeric>
              {String(i + 1).padStart(2, "0")}
            </span>
            {s.heading}
          </h3>
          <ul className="list-disc space-y-1.5 ps-6 marker:text-primary">
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
        <section className="mx-auto max-w-[68ch] space-y-3">
          <h3 className="font-mono text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
            Key terms
          </h3>
          <dl className="grid gap-x-5 gap-y-4 rounded-2xl border bg-background p-4 sm:grid-cols-2 sm:p-5">
            {notes.keyTerms.map((t) => (
              <div key={t.term} className="space-y-1">
                <dt className="font-semibold">{t.term}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">
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
