import type { Env } from "./types";
import { handleEvent } from "./ingest";
import { handleStats } from "./stats";
import { isAuthed, login, logout } from "./auth";
import { loginPage, dashboardPage } from "./dashboard";
import { TRACKER_SCRIPT } from "./tracker";

/**
 * Plausible-for-Cloudflare — a single Worker that serves three surfaces:
 *   1. the public tracking script  (GET /js/script.js)
 *   2. the public event ingest API (POST /api/event)  — Plausible wire-compatible
 *   3. the private dashboard + read API (GET / and /api/stats/*)
 */
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method.toUpperCase();

    // --- Public: event ingestion (CORS-open, no preflight needed for text/plain) ---
    if (pathname === "/api/event") {
      if (method === "OPTIONS") return cors(new Response(null, { status: 204 }));
      if (method === "POST") return cors(await handleEvent(req, env, ctx));
      // Health ping used by some Plausible setups.
      return cors(new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }));
    }

    // --- Public: tracking script (all Plausible variant names resolve here) ---
    if (pathname === "/js/script.js" || /^\/js\/script(\.[a-z-]+)*\.js$/.test(pathname)) {
      return new Response(TRACKER_SCRIPT, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=86400, must-revalidate",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (pathname === "/health") {
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }

    // --- Auth endpoints ---
    if (pathname === "/login") {
      if (method === "POST") return login(req, env);
      return loginPage(url.searchParams.get("error") === "1");
    }
    if (pathname === "/logout") return logout();

    // --- Everything below requires a valid dashboard session ---
    const authed = await isAuthed(req, env);

    if (pathname.startsWith("/api/stats")) {
      if (!authed) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      return handleStats(url, env);
    }

    if (pathname === "/" || pathname === "") {
      if (!authed) return Response.redirect(new URL("/login", req.url).toString(), 302);
      return dashboardPage(env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function cors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "POST, OPTIONS");
  h.set("access-control-allow-headers", "content-type");
  h.set("access-control-max-age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}
