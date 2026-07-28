import type { Env } from "./types";
import { getFunnelByName } from "./funnels";

/**
 * Read-only stats API consumed by the dashboard. All endpoints are scoped to the
 * configured site domain and a time period.
 *
 *   GET /api/stats/current                       → live visitors (last 5 min)
 *   GET /api/stats/aggregate?period=7d           → top-line metrics
 *   GET /api/stats/timeseries?period=7d          → visitors/pageviews per bucket
 *   GET /api/stats/breakdown?property=page&period=7d&limit=9
 */
export async function handleStats(url: URL, env: Env): Promise<Response> {
  const sub = url.pathname.replace(/^\/api\/stats\/?/, "");
  const domain = env.SITE_DOMAIN === "*" ? url.searchParams.get("domain") ?? "" : env.SITE_DOMAIN;
  const period = parsePeriod(url.searchParams.get("period") ?? "7d");

  switch (sub) {
    case "current":
      return json(await currentVisitors(env, domain));
    case "aggregate":
      return json(await aggregate(env, domain, period));
    case "compare":
      return json(await compare(env, domain, period));
    case "timeseries":
      return json(await timeseries(env, domain, period));
    case "breakdown":
      return json(
        await breakdown(
          env,
          domain,
          period,
          url.searchParams.get("property") ?? "page",
          clampInt(url.searchParams.get("limit"), 9, 1, 100),
        ),
      );
    case "funnel": {
      const name = url.searchParams.get("name");
      let steps: string[];
      let funnelName: string | undefined;
      if (name) {
        const def = await getFunnelByName(env, name);
        if (!def) return json({ error: `no saved funnel named '${name}'` }, 404);
        steps = def.steps;
        funnelName = def.name;
      } else {
        steps = (url.searchParams.get("steps") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (steps.length < 2) return json({ error: "funnel requires at least 2 comma-separated steps" }, 400);
      return json({ name: funnelName, ...(await funnel(env, domain, period, steps.slice(0, 8))) });
    }
    case "events":
      return json(
        await recentEvents(
          env,
          domain,
          period,
          clampInt(url.searchParams.get("limit"), 20, 1, 100),
          url.searchParams.get("name") ?? undefined,
        ),
      );
    default:
      return json({ error: "unknown stats endpoint" }, 404);
  }
}

// --------------------------------------------------------------------------- //
// Period handling
// --------------------------------------------------------------------------- //

type Interval = "hour" | "date" | "month";
interface Period {
  from: number; // unix seconds, inclusive
  to: number; // unix seconds, exclusive
  interval: Interval;
  buckets: string[]; // pre-computed bucket labels for a gap-free timeseries
  label: string;
}

/** Valid `period` values, exported so the MCP tool schema can advertise them. */
export const PERIODS = ["day", "7d", "30d", "month", "6mo", "12mo"] as const;

export function parsePeriod(raw: string): Period {
  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;

  switch (raw) {
    case "day":
      return { from: midnight, to: nowSec, interval: "hour", buckets: hourBuckets(midnight, 24), label: "Today" };
    case "30d":
      return dayPeriod(midnight, nowSec, 30, "Last 30 days");
    case "month": {
      const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
      const days = Math.floor((nowSec - first) / 86400) + 1;
      return dayPeriod(first + (days - 1) * 86400, nowSec, days, "This month");
    }
    case "6mo":
      return monthPeriod(now, 6, "Last 6 months");
    case "12mo":
      return monthPeriod(now, 12, "Last 12 months");
    case "7d":
    default:
      return dayPeriod(midnight, nowSec, 7, "Last 7 days");
  }
}

function dayPeriod(lastMidnight: number, nowSec: number, days: number, label: string): Period {
  const from = lastMidnight - (days - 1) * 86400;
  return { from, to: nowSec, interval: "date", buckets: dateBuckets(from, days), label };
}

function monthPeriod(now: Date, months: number, label: string): Period {
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1) / 1000;
  const to = Math.floor(now.getTime() / 1000);
  return { from, to, interval: "month", buckets: monthBuckets(now, months), label };
}

function hourBuckets(startSec: number, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date((startSec + i * 3600) * 1000);
    out.push(`${iso(d)} ${pad(d.getUTCHours())}:00`);
  }
  return out;
}
function dateBuckets(startSec: number, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(iso(new Date((startSec + i * 86400) * 1000)));
  return out;
}
function monthBuckets(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  }
  return out;
}
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const pad = (n: number) => String(n).padStart(2, "0");

function bucketExpr(interval: Interval): string {
  switch (interval) {
    case "hour":
      return "strftime('%Y-%m-%d %H:00', timestamp, 'unixepoch')";
    case "month":
      return "strftime('%Y-%m', timestamp, 'unixepoch')";
    case "date":
    default:
      return "strftime('%Y-%m-%d', timestamp, 'unixepoch')";
  }
}

// --------------------------------------------------------------------------- //
// Queries
// --------------------------------------------------------------------------- //

export async function currentVisitors(env: Env, domain: string): Promise<{ visitors: number }> {
  const cutoff = Math.floor(Date.now() / 1000) - 300;
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS v FROM sessions WHERE domain = ? AND last_activity >= ?`,
  )
    .bind(domain, cutoff)
    .first<{ v: number }>();
  return { visitors: row?.v ?? 0 };
}

interface Aggregate {
  visitors: number;
  pageviews: number;
  visits: number;
  bounce_rate: number;
  visit_duration: number;
  period: string;
}

export async function aggregate(env: Env, domain: string, p: Period): Promise<Aggregate> {
  const ev = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS visitors,
            SUM(CASE WHEN name = 'pageview' THEN 1 ELSE 0 END) AS pageviews
       FROM events WHERE domain = ? AND timestamp >= ? AND timestamp < ?`,
  )
    .bind(domain, p.from, p.to)
    .first<{ visitors: number; pageviews: number }>();

  const se = await env.DB.prepare(
    `SELECT COUNT(*) AS visits,
            ROUND(AVG(CASE WHEN is_bounce = 1 THEN 100.0 ELSE 0 END)) AS bounce_rate,
            ROUND(AVG(duration)) AS visit_duration
       FROM sessions WHERE domain = ? AND start >= ? AND start < ?`,
  )
    .bind(domain, p.from, p.to)
    .first<{ visits: number; bounce_rate: number; visit_duration: number }>();

  return {
    visitors: ev?.visitors ?? 0,
    pageviews: ev?.pageviews ?? 0,
    visits: se?.visits ?? 0,
    bounce_rate: se?.bounce_rate ?? 0,
    visit_duration: se?.visit_duration ?? 0,
    period: p.label,
  };
}

type Metrics = Omit<Aggregate, "period">;

export interface Comparison {
  period: string;
  current: Metrics;
  previous: Metrics;
  /** Percentage change per metric vs the previous equal-length period; null when there is no baseline. */
  change: Record<keyof Metrics, number | null>;
}

/**
 * Compare the selected period against the immediately-preceding period of the
 * same length (e.g. this 7 days vs the previous 7 days), with a % delta per metric.
 */
export async function compare(env: Env, domain: string, p: Period): Promise<Comparison> {
  const span = p.to - p.from;
  const prev: Period = { ...p, from: p.from - span, to: p.from, label: "previous" };

  const [cur, old] = await Promise.all([aggregate(env, domain, p), aggregate(env, domain, prev)]);
  const strip = (a: Aggregate): Metrics => ({
    visitors: a.visitors,
    pageviews: a.pageviews,
    visits: a.visits,
    bounce_rate: a.bounce_rate,
    visit_duration: a.visit_duration,
  });
  const current = strip(cur);
  const previous = strip(old);

  const pct = (now: number, before: number): number | null =>
    before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10;
  const change = {} as Record<keyof Metrics, number | null>;
  (Object.keys(current) as (keyof Metrics)[]).forEach((k) => (change[k] = pct(current[k], previous[k])));

  return { period: p.label, current, previous, change };
}

export async function timeseries(env: Env, domain: string, p: Period): Promise<{ interval: Interval; series: { date: string; visitors: number; pageviews: number }[] }> {
  const expr = bucketExpr(p.interval);
  const rows = await env.DB.prepare(
    `SELECT ${expr} AS bucket,
            COUNT(DISTINCT user_id) AS visitors,
            SUM(CASE WHEN name = 'pageview' THEN 1 ELSE 0 END) AS pageviews
       FROM events WHERE domain = ? AND timestamp >= ? AND timestamp < ?
      GROUP BY bucket`,
  )
    .bind(domain, p.from, p.to)
    .all<{ bucket: string; visitors: number; pageviews: number }>();

  const byBucket = new Map(rows.results.map((r) => [r.bucket, r]));
  const series = p.buckets.map((b) => {
    const r = byBucket.get(b);
    return { date: b, visitors: r?.visitors ?? 0, pageviews: r?.pageviews ?? 0 };
  });
  return { interval: p.interval, series };
}

interface BreakdownItem {
  name: string;
  visitors: number;
  pageviews?: number;
}

/** property → SQL source. Values from `sessions` are per-visit; `page`/`goal` are per-event. */
const PROPS: Record<string, { table: "sessions" | "events"; column: string; where?: string; pageviews?: boolean }> = {
  page: { table: "events", column: "pathname", where: "name = 'pageview'", pageviews: true },
  entry_page: { table: "sessions", column: "entry_page" },
  exit_page: { table: "sessions", column: "exit_page" },
  source: { table: "sessions", column: "referrer_source" },
  referrer: { table: "sessions", column: "referrer" },
  utm_source: { table: "sessions", column: "utm_source" },
  utm_medium: { table: "sessions", column: "utm_medium" },
  utm_campaign: { table: "sessions", column: "utm_campaign" },
  country: { table: "sessions", column: "country" },
  region: { table: "sessions", column: "region" },
  city: { table: "sessions", column: "city" },
  browser: { table: "sessions", column: "browser" },
  browser_version: { table: "sessions", column: "browser_version" },
  os: { table: "sessions", column: "os" },
  os_version: { table: "sessions", column: "os_version" },
  device: { table: "sessions", column: "device" },
  screen_size: { table: "sessions", column: "screen_size" },
  goal: { table: "events", column: "name", where: "name != 'pageview'", pageviews: true },
};

/** All breakdown dimensions, exported so the MCP tool schema can advertise them. */
export const PROPERTIES = Object.keys(PROPS);

// --------------------------------------------------------------------------- //
// Funnels
// --------------------------------------------------------------------------- //

export interface FunnelStep {
  step: string;
  visitors: number;
  conversion_rate: number; // % of visitors who entered the funnel (step 1)
  dropoff: number; // visitors lost vs the previous step
}

/**
 * Ordered conversion funnel. Each step is either a page path (starts with "/")
 * or a custom event/goal name. A visitor "completes" step k only if they hit it
 * *after* completing step k-1, so the funnel is strictly ordered in time.
 */
/** Upper bound on events scanned per funnel query, to stay inside D1/Worker limits. */
const MAX_FUNNEL_EVENTS = 50_000;

export async function funnel(
  env: Env,
  domain: string,
  p: Period,
  steps: string[],
): Promise<{ steps: FunnelStep[]; entered: number; truncated?: boolean }> {
  const pages = steps.filter((s) => s.startsWith("/"));
  const goals = steps.filter((s) => !s.startsWith("/"));

  const clauses: string[] = [];
  const binds: unknown[] = [domain, p.from, p.to];
  if (pages.length) {
    clauses.push(`(name = 'pageview' AND pathname IN (${pages.map(() => "?").join(",")}))`);
    binds.push(...pages);
  }
  if (goals.length) {
    clauses.push(`(name IN (${goals.map(() => "?").join(",")}))`);
    binds.push(...goals);
  }

  const rows = await env.DB.prepare(
    `SELECT user_id, name, pathname, timestamp
       FROM events
      WHERE domain = ? AND timestamp >= ? AND timestamp < ? AND (${clauses.join(" OR ")})
      ORDER BY user_id, timestamp
      LIMIT ${MAX_FUNNEL_EVENTS + 1}`,
  )
    .bind(...binds)
    .all<{ user_id: string; name: string; pathname: string; timestamp: number }>();

  // If we hit the cap, drop the final (possibly partial) visitor and say so
  // rather than returning silently-wrong numbers.
  const truncated = rows.results.length > MAX_FUNNEL_EVENTS;
  if (truncated) rows.results.length = MAX_FUNNEL_EVENTS;

  const matches = (ev: { name: string; pathname: string }, step: string) =>
    step.startsWith("/") ? ev.name === "pageview" && ev.pathname === step : ev.name === step;

  // Walk each visitor's events in time order, advancing through the steps.
  const counts = new Array(steps.length).fill(0);
  let currentUser = "";
  let cursor = 0;
  const advance = () => {
    for (let k = 0; k < cursor; k++) counts[k]++;
  };
  for (const ev of rows.results) {
    if (ev.user_id !== currentUser) {
      advance();
      currentUser = ev.user_id;
      cursor = 0;
    }
    if (cursor < steps.length && matches(ev, steps[cursor])) cursor++;
  }
  advance(); // flush the final visitor

  const entered = counts[0] || 0;
  const result: FunnelStep[] = steps.map((step, i) => ({
    step,
    visitors: counts[i],
    conversion_rate: entered ? Math.round((counts[i] / entered) * 1000) / 10 : 0,
    dropoff: i === 0 ? 0 : counts[i - 1] - counts[i],
  }));
  return truncated ? { steps: result, entered, truncated } : { steps: result, entered };
}

// --------------------------------------------------------------------------- //
// Raw event export
// --------------------------------------------------------------------------- //

export interface RawEvent {
  timestamp: number;
  time: string; // ISO-8601
  name: string;
  pathname: string;
  source: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  props: string | null;
}

/** Most recent raw events (newest first), optionally filtered to one event name. */
export async function recentEvents(
  env: Env,
  domain: string,
  p: Period,
  limit: number,
  name?: string,
): Promise<{ results: RawEvent[] }> {
  const filters = ["domain = ?", "timestamp >= ?", "timestamp < ?"];
  const binds: unknown[] = [domain, p.from, p.to];
  if (name) {
    filters.push("name = ?");
    binds.push(name);
  }
  binds.push(limit);

  const rows = await env.DB.prepare(
    `SELECT timestamp, name, pathname, referrer_source AS source, country, browser, os, device, props
       FROM events
      WHERE ${filters.join(" AND ")}
      ORDER BY timestamp DESC
      LIMIT ?`,
  )
    .bind(...binds)
    .all<Omit<RawEvent, "time">>();

  return {
    results: rows.results.map((r) => ({ ...r, time: new Date(r.timestamp * 1000).toISOString() })),
  };
}

export async function breakdown(env: Env, domain: string, p: Period, property: string, limit: number): Promise<{ property: string; results: BreakdownItem[] }> {
  const spec = PROPS[property];
  if (!spec) return { property, results: [] };

  const tsCol = spec.table === "sessions" ? "start" : "timestamp";
  const filters = [`domain = ?`, `${tsCol} >= ?`, `${tsCol} < ?`, `${spec.column} IS NOT NULL`, `${spec.column} != ''`];
  if (spec.where) filters.push(spec.where);

  const pvSelect = spec.pageviews ? `, COUNT(*) AS pageviews` : ``;
  const sql =
    `SELECT ${spec.column} AS name, COUNT(DISTINCT user_id) AS visitors${pvSelect}
       FROM ${spec.table}
      WHERE ${filters.join(" AND ")}
      GROUP BY ${spec.column}
      ORDER BY visitors DESC, name ASC
      LIMIT ?`;

  const rows = await env.DB.prepare(sql).bind(domain, p.from, p.to, limit).all<BreakdownItem>();
  return { property, results: rows.results };
}

// --------------------------------------------------------------------------- //

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
