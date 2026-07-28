import type { Env } from "./types";
import { handleEvent } from "./ingest";
import { handleStats } from "./stats";
import { isAuthed, login, logout } from "./auth";
import { loginPage, dashboardPage } from "./dashboard";
import { TRACKER_SCRIPT, INSIGHTS_SCRIPT } from "./tracker";
import { handleMcp } from "./mcp/server";
import { handleFunnels } from "./funnels";

/**
 * Insights — a single Cloudflare Worker that serves four surfaces:
 *   1. the public tracking scripts  (GET /insights.js and /js/script.js)
 *   2. the public event ingest API  (POST /api/event) — native + Plausible-compatible
 *   3. the private dashboard + read API (GET / and /api/stats/*)
 *   4. an MCP server for AI clients  (POST /mcp), bearer-authenticated
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

    // --- MCP server (bearer-authenticated inside handleMcp) ---
    if (pathname === "/mcp") return handleMcp(req, env);

    // --- Public: native tracking script ---
    if (pathname === "/insights.js" || /^\/insights(\.[a-z-]+)*\.js$/.test(pathname)) {
      return scriptResponse(INSIGHTS_SCRIPT);
    }

    // --- Public: Plausible-compatible tracking script (all variant names resolve here) ---
    if (pathname === "/js/script.js" || /^\/js\/script(\.[a-z-]+)*\.js$/.test(pathname)) {
      return scriptResponse(TRACKER_SCRIPT);
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
      if (!authed) return unauthorized();
      return handleStats(url, env);
    }

    if (pathname === "/api/funnels") {
      if (!authed) return unauthorized();
      return handleFunnels(req, url, env);
    }

    if (pathname === "/" || pathname === "") {
      if (!authed) return Response.redirect(new URL("/login", req.url).toString(), 302);
      return dashboardPage(env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function scriptResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=86400, must-revalidate",
      "access-control-allow-origin": "*",
    },
  });
}

function cors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "POST, OPTIONS");
  h.set("access-control-allow-headers", "content-type");
  h.set("access-control-max-age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}
