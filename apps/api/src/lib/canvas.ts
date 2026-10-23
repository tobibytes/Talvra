import { CANVAS_HOST_PATTERN } from "@talvra/contracts";

export class CanvasError extends Error {
  constructor(
    readonly kind: "unauthorized" | "unavailable" | "bad_response",
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

export type Fetch = typeof fetch;

/**
 * Minimal Canvas REST client. Session 4 adds retries with backoff and more
 * endpoints. Only *.instructure.com over https is ever contacted.
 */
export class CanvasClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || !CANVAS_HOST_PATTERN.test(url.hostname)) {
      throw new CanvasError("bad_response", "Refusing to call a non-Canvas host");
    }
  }

  private async request(pathOrUrl: string) {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${this.baseUrl}/api/v1${pathOrUrl}`;
    // Follow-up page links must stay on the same Canvas host.
    if (new URL(url).origin !== new URL(this.baseUrl).origin) {
      throw new CanvasError("bad_response", "Canvas returned a link to another host");
    }
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CanvasError("unavailable", "Couldn't reach Canvas. Try again in a minute.");
    }
    if (res.status === 401) throw new CanvasError("unauthorized", "Canvas rejected this token.");
    if (!res.ok) throw new CanvasError("unavailable", `Canvas returned ${res.status}.`);
    return res;
  }

  async getSelf(): Promise<{ id: number; name: string }> {
    const body = (await (await this.request("/users/self")).json()) as {
      id?: number;
      name?: string;
    };
    if (typeof body.id !== "number")
      throw new CanvasError("bad_response", "Unexpected Canvas response.");
    return { id: body.id, name: body.name ?? "Canvas user" };
  }

  /** All pages of a list endpoint, following RFC 5988 Link headers. */
  async list<T>(path: string, maxPages = 20): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    for (let page = 0; next && page < maxPages; page++) {
      const res = await this.request(next);
      const items = (await res.json()) as T[];
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
}

export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m?.[1]) return m[1];
  }
  return null;
}
