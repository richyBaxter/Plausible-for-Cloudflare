/// <reference types="@cloudflare/workers-types" />

/** Bindings and vars declared in wrangler.jsonc + secrets set via `wrangler secret put`. */
export interface Env {
  DB: D1Database;
  SALT_KV: KVNamespace;
  /** Optional: present only if the analytics_engine_datasets binding is enabled. */
  AE?: AnalyticsEngineDataset;

  // vars
  SITE_DOMAIN: string;
  SITE_NAME: string;

  // secrets
  DASHBOARD_PASSWORD: string;
  AUTH_SECRET: string;
}

/** Raw event payload as sent by the tracking script (Plausible wire-compatible). */
export interface EventPayload {
  n: string; // event name ('pageview' or custom)
  u: string; // full URL of the page
  d: string; // data-domain
  r?: string | null; // referrer
  w?: number; // viewport width
  h?: number | boolean; // hash-based routing flag
  p?: Record<string, unknown> | string | null; // custom props
}

/** Fully enriched, storage-ready event derived from a payload + request context. */
export interface EnrichedEvent {
  timestamp: number;
  name: string;
  domain: string;
  userId: string;
  hostname: string;
  pathname: string;
  referrer: string | null;
  referrerSource: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  device: string | null;
  screenSize: string | null;
  props: string | null;
}
