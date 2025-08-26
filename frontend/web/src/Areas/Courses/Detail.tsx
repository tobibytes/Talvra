import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TalvraSurface, TalvraStack, TalvraText, TalvraCard, TalvraLink, TalvraButton } from '@ui';
import { FRONT_ROUTES, buildPath } from '@/app/routes';

const API_BASE: string = (import.meta as any).env?.VITE_API_BASE ?? 'http://localhost:3001';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return (await res.json()) as T;
}

async function postJSON<T>(url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return (await res.json()) as T;
}

// Kickoff helper: POST with no JSON body or content-type header
async function postKickoff<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include', method: 'POST' });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return (await res.json()) as T;
}

interface DocRow {
  doc_id: string;
  title: string | null;
  course_canvas_id: string | null;
  module_canvas_id: string | null;
  module_item_canvas_id: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

interface AssignmentRow {
  id: string;
  name: string;
  due_at?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export default function CourseDetailArea() {
  const { courseId } = useParams<{ courseId: string }>();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [errorDocs, setErrorDocs] = useState<string | null>(null);
  const [errorAssign, setErrorAssign] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false); // busy only for kickoff
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  // Async job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<null | {
    status: 'pending' | 'running' | 'completed' | 'failed' | string;
    processed: number;
    skipped: number;
    errors: number;
    created_at?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
    error_message?: string | null;
  }>(null);

  async function loadDocs(cancelledFlag?: { v: boolean }) {
    setErrorDocs(null);
    try {
      const data = await fetchJSON<{ ok: true; documents: DocRow[] }>(
        `${API_BASE}/api/canvas/documents?course_id=${encodeURIComponent(courseId || '')}&limit=200`
      );
      if (!cancelledFlag?.v) setDocs(data.documents);
    } catch (e: any) {
      if (!cancelledFlag?.v) setErrorDocs(String(e?.message || e));
    }
  }

  async function loadAssignments(cancelledFlag?: { v: boolean }) {
    setErrorAssign(null);
    try {
      const data = await fetchJSON<{ ok: true; assignments: AssignmentRow[] }>(
        `${API_BASE}/api/canvas/assignments?course_id=${encodeURIComponent(courseId || '')}`
      );
      if (!cancelledFlag?.v) setAssignments(data.assignments);
    } catch (e: any) {
      if (!cancelledFlag?.v) setErrorAssign(String(e?.message || e));
    }
  }

async function syncNow() {
  if (!courseId) return;
  setSyncBusy(true);
  setSyncMsg(null);
  try {
    // Kick off async job and return immediately
    const res = await postKickoff<{ ok: true; job_id: string; existing?: boolean }>(
      `${API_BASE}/api/canvas/sync/course/${encodeURIComponent(courseId)}/start`
    );
    const jid = res.job_id;
    setJobId(jid);
    // Persist in localStorage so we can restore after navigation
    try { localStorage.setItem(`canvasSyncJob:${courseId}`, JSON.stringify({ job_id: jid, ts: Date.now() })); } catch {}
    setSyncMsg(res.existing ? 'Sync already running…' : 'Sync started…');
  } catch (e: any) {
    setSyncMsg(`Sync kickoff failed: ${String(e?.message || e)}`);
  } finally {
    setSyncBusy(false);
  }
}

useEffect(() => {
  let cancelled = { v: false };
  if (courseId) {
    void loadDocs(cancelled);
    void loadAssignments(cancelled);
    // Restore active job if present
    try {
      const raw = localStorage.getItem(`canvasSyncJob:${courseId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { job_id: string };
        if (parsed?.job_id) setJobId(parsed.job_id);
      }
    } catch {}
  }
  return () => { cancelled.v = true };
}, [courseId]);

// Poll job status when jobId is set
useEffect(() => {
  if (!jobId || !courseId) return;
  let stopped = false;
  const interval = setInterval(async () => {
    try {
      const s = await fetchJSON<{ ok: true; job: any }>(`${API_BASE}/api/canvas/sync/status/${encodeURIComponent(jobId)}`);
      if (stopped) return;
      const j = s.job || {};
      setJob({
        status: j.status,
        processed: Number(j.processed || 0),
        skipped: Number(j.skipped || 0),
        errors: Number(j.errors || 0),
        created_at: j.created_at ?? null,
        started_at: j.started_at ?? null,
        finished_at: j.finished_at ?? null,
        error_message: j.error_message ?? null,
      });
      if (j.status === 'completed' || j.status === 'failed') {
        clearInterval(interval);
        try { localStorage.removeItem(`canvasSyncJob:${courseId}`); } catch {}
        // Refresh data on completion
        await Promise.all([loadDocs(), loadAssignments()]);
      }
    } catch (e) {
      // If status not found, stop polling (job expired)
      clearInterval(interval);
      try { localStorage.removeItem(`canvasSyncJob:${courseId}`); } catch {}
    }
  }, 1500);
  return () => { stopped = true; clearInterval(interval); };
}, [jobId, courseId]);

  return (
    <TalvraSurface>
      <TalvraStack>
        <TalvraText as="h1">Course {courseId}</TalvraText>

<TalvraStack>
          <TalvraText as="h2">Documents</TalvraText>
          <TalvraStack>
            <TalvraButton disabled={syncBusy || (job && (job.status === 'pending' || job.status === 'running'))} onClick={syncNow}>
              {syncBusy ? 'Starting…' : (job && (job.status === 'pending' || job.status === 'running')) ? 'Sync in progress…' : 'Sync now'}
            </TalvraButton>
            {syncMsg && <TalvraText>{syncMsg}</TalvraText>}
          </TalvraStack>
          {job && (
            <TalvraCard>
              <TalvraStack>
                <TalvraText>
                  Sync status: {job.status}
                  {job.status === 'failed' && job.error_message ? ` — ${job.error_message}` : ''}
                </TalvraText>
                <TalvraText style={{ color: '#64748b' }}>
                  processed {job.processed} • skipped {job.skipped} • errors {job.errors}
                </TalvraText>
              </TalvraStack>
            </TalvraCard>
          )}
          {errorDocs && <TalvraText>Error loading documents: {errorDocs}</TalvraText>}
          <TalvraCard>
            <TalvraStack>
              {!docs ? (
                <TalvraText>Loading…</TalvraText>
              ) : docs.length === 0 ? (
                <TalvraText>No documents synced yet. Try Settings → Sync now.</TalvraText>
              ) : (
                docs.map((d) => (
                  <TalvraCard key={d.doc_id}>
                    <TalvraStack>
                      <TalvraText as="h4">{d.title ?? d.doc_id}</TalvraText>
                      <TalvraStack>
                        <TalvraLink href={buildPath(FRONT_ROUTES.DOCUMENT_DETAIL, { documentId: d.doc_id })}>Open</TalvraLink>
                        <TalvraLink href={buildPath(FRONT_ROUTES.DOCUMENT_AI, { documentId: d.doc_id })}>AI</TalvraLink>
                        <TalvraLink href={buildPath(FRONT_ROUTES.DOCUMENT_VIDEO, { documentId: d.doc_id })}>Video</TalvraLink>
                      </TalvraStack>
                      <TalvraText style={{ color: '#64748b' }}>
                        {d.mime_type ?? 'unknown'} • {d.size_bytes ? `${d.size_bytes} bytes` : 'size unknown'} • {new Date(d.created_at).toLocaleString()}
                      </TalvraText>
                    </TalvraStack>
                  </TalvraCard>
                ))
              )}
            </TalvraStack>
          </TalvraCard>
        </TalvraStack>

        <TalvraStack>
          <TalvraText as="h2">Assignments</TalvraText>
          {errorAssign && <TalvraText>Error loading assignments: {errorAssign}</TalvraText>}
          <TalvraCard>
            <TalvraStack>
              {!assignments ? (
                <TalvraText>Loading…</TalvraText>
              ) : assignments.length === 0 ? (
                <TalvraText>No assignments found.</TalvraText>
              ) : (
                assignments.map((a) => (
                  <TalvraCard key={a.id}>
                    <TalvraStack>
                      <TalvraText as="h4">{a.name}</TalvraText>
                      <TalvraText style={{ color: '#64748b' }}>
                        {a.due_at ? `Due ${new Date(a.due_at).toLocaleString()}` : 'No due date'}
                      </TalvraText>
                      <TalvraStack>
                        {a.html_url && (
                          <a href={a.html_url} target="_blank" rel="noreferrer">Open in Canvas</a>
                        )}
                      </TalvraStack>
                    </TalvraStack>
                  </TalvraCard>
                ))
              )}
            </TalvraStack>
          </TalvraCard>
        </TalvraStack>

        <TalvraStack>
          <TalvraText as="h2">Navigation</TalvraText>
          <TalvraStack>
            <TalvraLink href={buildPath(FRONT_ROUTES.COURSES)}>
              Back to Courses
            </TalvraLink>
            <TalvraLink href={buildPath(FRONT_ROUTES.SETTINGS)}>
              Settings
            </TalvraLink>
          </TalvraStack>
        </TalvraStack>
      </TalvraStack>
    </TalvraSurface>
  );
}
