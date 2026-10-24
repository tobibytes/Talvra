/**
 * Front door for every request (the Worker runs before static assets):
 * `www.` → 301 to the bare domain, `/api/*` → the Hono app, anything else → the SPA's assets.
 */
export function frontDoor(
  api: (req: Request) => Response | Promise<Response>,
  assets: { fetch: (req: Request) => Promise<Response> } | undefined,
  req: Request,
) {
  const url = new URL(req.url);
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }
  if (url.pathname === "/api" || url.pathname.startsWith("/api/") || !assets) return api(req);
  return assets.fetch(req);
}
