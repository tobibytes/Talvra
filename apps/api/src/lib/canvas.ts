import { CANVAS_HOST_PATTERN } from "@talvra/contracts";

export class CanvasError extends Error {
  constructor(
    readonly kind: "unauthorized" | "forbidden" | "not_found" | "unavailable" | "bad_response",
    message: string,
  ) {
    super(message);
  }
}

export type CanvasCourseRaw = {
  id: number;
  name?: string;
  course_code?: string;
  term?: { name?: string };
  access_restricted_by_date?: boolean;
};

export type CanvasModuleItemRaw = {
  id: number;
  position?: number;
  indent?: number;
  title?: string;
  type?: string;
  content_id?: number;
  page_url?: string;
  html_url?: string;
  external_url?: string;
  published?: boolean;
};

export type CanvasModuleRaw = {
  id: number;
  name?: string;
  position?: number;
  items_count?: number;
  /** Omitted by Canvas when a module has too many items; fetch them separately. */
  items?: CanvasModuleItemRaw[];
};

export type CanvasAssignmentRaw = {
  id: number;
  name?: string;
  description?: string | null;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  published?: boolean;
  html_url?: string;
  updated_at?: string;
};

export type CanvasFileRaw = {
  id: number;
  display_name?: string;
  filename?: string;
  "content-type"?: string;
  size?: number;
  folder_id?: number;
  updated_at?: string;
  locked_for_user?: boolean;
};

export type CanvasFolderRaw = { id: number; full_name?: string };

export type CanvasPageRaw = {
  page_id: number;
  url: string;
  title?: string;
  updated_at?: string;
  published?: boolean;
  body?: string | null;
};

export type Fetch = typeof fetch;

export type CanvasClientOptions = {
  /** Total attempts per request, including the first. */
  maxAttempts?: number;
  /** Injected in tests so backoff doesn't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const CANVAS_USER_AGENT = "Talvra/2.0 (+https://talvra.app; study app for Morgan State)";

/** Canvas allows ~700 "cost units" per token; below this we pace ourselves. */
const RATE_LIMIT_LOW_WATER = 150;

/**
 * Canvas REST client. Only *.instructure.com over https is ever contacted,
 * redirects are refused, and pagination links must stay on the same host.
 * Transient failures (429, 5xx, network) are retried with exponential backoff
 * and jitter, honoring Retry-After.
 */
export class CanvasClient {
  private readonly fetchImpl: Fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    fetchImpl: Fetch = fetch,
    opts: CanvasClientOptions = {},
  ) {
    // Never call the global fetch as a method (`this.fetch(...)`): workerd
    // throws "Illegal invocation" when `this` isn't the global scope.
    this.fetchImpl = (input, init) => fetchImpl(input, init);
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || !CANVAS_HOST_PATTERN.test(url.hostname)) {
      throw new CanvasError("bad_response", "Refusing to call a non-Canvas host");
    }
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.sleep = opts.sleep ?? realSleep;
    this.random = opts.random ?? Math.random;
  }

  get origin() {
    return new URL(this.baseUrl).origin;
  }

  /** Backoff for attempt n (0-based): full jitter over 0.5s * 2^n, capped at 20s. */
  backoffMs(attempt: number, retryAfter: string | null) {
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 60) * 1000;
    return Math.round(this.random() * Math.min(20_000, 500 * 2 ** attempt));
  }

  private async request(pathOrUrl: string) {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${this.baseUrl}/api/v1${pathOrUrl}`;
    // Follow-up page links must stay on the same Canvas host.
    if (new URL(url).origin !== this.origin) {
      throw new CanvasError("bad_response", "Canvas returned a link to another host");
    }
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= this.maxAttempts - 1;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
            // Canvas rejects API calls without a User-Agent (403), and Workers sends none.
            "User-Agent": CANVAS_USER_AGENT,
          },
          // Never follow redirects (SSRF). workerd doesn't support "error",
          // so take them manually and reject any 3xx below.
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        console.warn(JSON.stringify({ msg: "canvas fetch failed", attempt, error: String(err) }));
        if (last) throw new CanvasError("unavailable", "Couldn't reach Canvas. Try again soon.");
        await this.sleep(this.backoffMs(attempt, null));
        continue;
      }
      if (res.status >= 300 && res.status < 400) {
        throw new CanvasError("bad_response", "Canvas tried to redirect; refusing to follow.");
      }
      if (res.ok) {
        const remaining = Number(res.headers.get("x-rate-limit-remaining"));
        if (Number.isFinite(remaining) && remaining < RATE_LIMIT_LOW_WATER) {
          // Leaky bucket refills over time; give it a moment instead of hitting 403/429.
          await this.sleep(1000);
        }
        return res;
      }
      if (res.status === 401) throw new CanvasError("unauthorized", "Canvas rejected this token.");
      // Canvas signals throttling with 403 + "Rate Limit Exceeded" (and sometimes 429).
      const throttled =
        res.status === 429 ||
        (res.status === 403 &&
          /rate limit/i.test(
            await res
              .clone()
              .text()
              .catch(() => ""),
          ));
      if (throttled || res.status >= 500) {
        if (last) throw new CanvasError("unavailable", `Canvas returned ${res.status}.`);
        await this.sleep(this.backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      if (res.status === 403)
        throw new CanvasError("forbidden", "Canvas doesn't allow access to this.");
      if (res.status === 404) throw new CanvasError("not_found", "Canvas couldn't find this.");
      throw new CanvasError("unavailable", `Canvas returned ${res.status}.`);
    }
  }

  private async json<T>(path: string): Promise<T> {
    try {
      return (await (await this.request(path)).json()) as T;
    } catch (err) {
      if (err instanceof CanvasError) throw err;
      throw new CanvasError("bad_response", "Unexpected Canvas response.");
    }
  }

  async getSelf(): Promise<{ id: number; name: string }> {
    const body = await this.json<{ id?: number; name?: string }>("/users/self");
    if (typeof body.id !== "number")
      throw new CanvasError("bad_response", "Unexpected Canvas response.");
    return { id: body.id, name: body.name ?? "Canvas user" };
  }

  /** All pages of a list endpoint, following RFC 5988 Link headers. */
  async list<T>(path: string, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    for (let page = 0; next && page < maxPages; page++) {
      const res = await this.request(next);
      const items = (await res.json().catch(() => null)) as T[] | null;
      if (!Array.isArray(items))
        throw new CanvasError("bad_response", "Unexpected Canvas response.");
      out.push(...items);
      next = parseNextLink(res.headers.get("link"));
    }
    return out;
  }

  async activeCourses() {
    const raw = await this.list<CanvasCourseRaw>(
      "/courses?enrollment_state=active&include[]=term&state[]=available",
    );
    return raw
      .filter((c) => c.name && !c.access_restricted_by_date)
      .map((c) => ({
        canvasId: String(c.id),
        name: c.name as string,
        courseCode: c.course_code ?? null,
        term: c.term?.name ?? null,
      }));
  }

  async modules(courseId: string): Promise<CanvasModuleRaw[]> {
    const c = encodeURIComponent(courseId);
    const mods = await this.list<CanvasModuleRaw>(
      `/courses/${c}/modules?include[]=items&include[]=content_details`,
    );
    for (const m of mods) {
      if (!m.items) {
        m.items = await this.list<CanvasModuleItemRaw>(
          `/courses/${c}/modules/${m.id}/items?include[]=content_details`,
        );
      }
    }
    return mods;
  }

  assignments(courseId: string) {
    return this.list<CanvasAssignmentRaw>(
      `/courses/${encodeURIComponent(courseId)}/assignments?order_by=due_at`,
    );
  }

  /** Throws `forbidden` when the course hides its Files tab from students. */
  files(courseId: string) {
    return this.list<CanvasFileRaw>(`/courses/${encodeURIComponent(courseId)}/files`);
  }

  file(courseId: string, fileId: string) {
    return this.json<CanvasFileRaw>(
      `/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}`,
    );
  }

  folders(courseId: string) {
    return this.list<CanvasFolderRaw>(`/courses/${encodeURIComponent(courseId)}/folders`);
  }

  /** Page list without bodies. Throws `forbidden`/`not_found` when Pages is disabled. */
  pages(courseId: string) {
    return this.list<CanvasPageRaw>(
      `/courses/${encodeURIComponent(courseId)}/pages?published=true`,
    );
  }

  page(courseId: string, pageUrl: string) {
    return this.json<CanvasPageRaw>(
      `/courses/${encodeURIComponent(courseId)}/pages/${encodeURIComponent(pageUrl)}`,
    );
  }

  /** Stable API url for a file (download urls are short-lived and never stored). */
  fileApiUrl(fileId: string) {
    return `${this.origin}/api/v1/files/${fileId}`;
  }

  pageApiUrl(courseId: string, pageUrl: string) {
    return `${this.origin}/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`;
  }
}

export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m?.[1]) return m[1];
  }
  return null;
}
