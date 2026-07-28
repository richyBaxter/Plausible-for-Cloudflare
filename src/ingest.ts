import type { Env, EventPayload, EnrichedEvent } from "./types";
import { visitorId } from "./identity";
import { parseUserAgent, screenSize, deriveSource } from "./enrich";

const SESSION_WINDOW = 30 * 60; // 30 minutes of inactivity ends a session (Plausible default)

/**
 * Handle POST /api/event — the tracking-script ingestion endpoint.
 * Wire-compatible with Plausible: same payload shape, same 202 response, same
 * text/plain content type to avoid a CORS preflight.
 */
export async function handleEvent(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const ua = req.headers.get("user-agent") ?? "";
  const uaInfo = parseUserAgent(ua);
  if (uaInfo.isBot) return accepted(); // silently drop bots, like Plausible

  let payload: EventPayload;
  try {
    payload = (await req.json()) as EventPayload;
  } catch {
    return new Response("Bad Request: invalid JSON", { status: 400 });
  }
  if (!payload || !payload.n || !payload.u || !payload.d) {
    return new Response("Bad Request: missing n/u/d", { status: 400 });
  }

  // Domain allow-list. SITE_DOMAIN="*" accepts any site (multi-tenant mode);
  // otherwise accept the configured apex domain and its subdomains.
  const domain = String(payload.d).toLowerCase();
  if (!domainAllowed(domain, env.SITE_DOMAIN)) {
    return new Response("Forbidden: domain not configured", { status: 403 });
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(payload.u);
  } catch {
    return new Response("Bad Request: invalid url", { status: 400 });
  }

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "0.0.0.0";
  const { userId, yesterdayUserId } = await visitorId(env, domain, ip, ua);

  const cf = (req as { cf?: IncomingRequestCfProperties }).cf;
  const src = deriveSource(pageUrl, payload.r ?? null, pageUrl.hostname);

  const enriched: EnrichedEvent = {
    timestamp: Math.floor(Date.now() / 1000),
    name: String(payload.n),
    domain,
    userId,
    hostname: pageUrl.hostname,
    pathname: normalisePath(pageUrl.pathname),
    referrer: src.referrer,
    referrerSource: src.referrerSource ?? "Direct",
    utmSource: src.utmSource,
    utmMedium: src.utmMedium,
    utmCampaign: src.utmCampaign,
    country: (cf?.country as string) ?? null,
    region: (cf?.regionCode as string) ?? null,
    city: (cf?.city as string) ?? null,
    browser: uaInfo.browser,
    browserVersion: uaInfo.browserVersion,
    os: uaInfo.os,
    osVersion: uaInfo.osVersion,
    device: uaInfo.device,
    screenSize: screenSize(payload.w),
    props: normaliseProps(payload.p),
  };

  // Do the DB work without blocking the tracking beacon.
  ctx.waitUntil(persist(env, enriched, yesterdayUserId));
  return accepted();
}

function accepted(): Response {
  return new Response(null, { status: 202, headers: { "content-type": "text/plain" } });
}

async function persist(env: Env, e: EnrichedEvent, yesterdayUserId: string | null): Promise<void> {
  const sessionId = await upsertSession(env, e, yesterdayUserId);

  await env.DB.prepare(
    `INSERT INTO events (
        timestamp, name, domain, user_id, session_id, hostname, pathname, referrer,
        referrer_source, utm_source, utm_medium, utm_campaign, country, region, city,
        browser, browser_version, os, os_version, device, screen_size, props)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      e.timestamp, e.name, e.domain, e.userId, sessionId, e.hostname, e.pathname, e.referrer,
      e.referrerSource, e.utmSource, e.utmMedium, e.utmCampaign, e.country, e.region, e.city,
      e.browser, e.browserVersion, e.os, e.osVersion, e.device, e.screenSize, e.props,
    )
    .run();

  // Optional mirror to Analytics Engine for long-term, SQL-queryable retention.
  if (env.AE) {
    env.AE.writeDataPoint({
      blobs: [e.domain, e.name, e.pathname, e.referrerSource ?? "", e.country ?? "", e.browser ?? "", e.os ?? "", e.device],
      doubles: [1],
      indexes: [e.domain],
    });
  }
}

/**
 * Find the visitor's active session (< 30 min since last activity) or open a new
 * one, then fold this event into it. Returns the session id to stamp on the event.
 */
async function upsertSession(env: Env, e: EnrichedEvent, yesterdayUserId: string | null): Promise<string> {
  const cutoff = e.timestamp - SESSION_WINDOW;
  const isPageview = e.name === "pageview";

  // Look for an open session under today's id, then under yesterday's (rotation straddle).
  let row = await findOpenSession(env, e.userId, e.domain, cutoff);
  if (!row && yesterdayUserId) {
    row = await findOpenSession(env, yesterdayUserId, e.domain, cutoff);
  }

  if (row) {
    const duration = e.timestamp - row.start;
    const pageviews = row.pageviews + (isPageview ? 1 : 0);
    await env.DB.prepare(
      `UPDATE sessions
         SET last_activity = ?, duration = ?, pageviews = ?, events = events + 1,
             is_bounce = ?, exit_page = ?
       WHERE session_id = ?`,
    )
      .bind(e.timestamp, duration, pageviews, pageviews > 1 ? 0 : 1, isPageview ? e.pathname : row.exit_page, row.session_id)
      .run();
    return row.session_id;
  }

  // New session.
  const sessionId = `${e.userId}-${e.timestamp}`;
  await env.DB.prepare(
    `INSERT INTO sessions (
        session_id, user_id, domain, start, last_activity, duration, is_bounce, pageviews, events,
        entry_page, exit_page, referrer, referrer_source, utm_source, utm_medium, utm_campaign,
        country, region, city, browser, browser_version, os, os_version, device, screen_size)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      sessionId, e.userId, e.domain, e.timestamp, e.timestamp, 0, 1, isPageview ? 1 : 0, 1,
      e.pathname, e.pathname, e.referrer, e.referrerSource, e.utmSource, e.utmMedium, e.utmCampaign,
      e.country, e.region, e.city, e.browser, e.browserVersion, e.os, e.osVersion, e.device, e.screenSize,
    )
    .run();
  return sessionId;
}

interface SessionRow {
  session_id: string;
  start: number;
  pageviews: number;
  exit_page: string | null;
}

function findOpenSession(env: Env, userId: string, domain: string, cutoff: number): Promise<SessionRow | null> {
  return env.DB.prepare(
    `SELECT session_id, start, pageviews, exit_page
       FROM sessions
      WHERE user_id = ? AND domain = ? AND last_activity >= ?
      ORDER BY last_activity DESC LIMIT 1`,
  )
    .bind(userId, domain, cutoff)
    .first<SessionRow>();
}

function domainAllowed(domain: string, configured: string): boolean {
  if (!configured || configured === "*") return true;
  const base = configured.toLowerCase();
  return domain === base || domain.endsWith(`.${base}`);
}

/** Keep the path, drop the query string and any trailing slash (except root). */
function normalisePath(path: string): string {
  let p = path.split("?")[0].split("#")[0] || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function normaliseProps(p: EventPayload["p"]): string | null {
  if (p == null) return null;
  try {
    if (typeof p === "string") return p.length ? p : null;
    const keys = Object.keys(p);
    return keys.length ? JSON.stringify(p) : null;
  } catch {
    return null;
  }
}
