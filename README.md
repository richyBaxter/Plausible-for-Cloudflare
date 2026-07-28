# Plausible-for-Cloudflare

A privacy-friendly, cookieless web-analytics platform that runs **entirely on the
Cloudflare edge** and is **wire-compatible with [Plausible Analytics](https://github.com/plausible/analytics)**.

Point any existing Plausible snippet at your deployment and it just works — same
tracking script, same `window.plausible(...)` API, same `/api/event` payload —
but instead of an Elixir + PostgreSQL + ClickHouse server it's a single
**Cloudflare Worker** backed by **D1** (SQLite) and **KV**. No servers, no
containers, no cold starts, generous free tier, and your visitors' data never
leaves Cloudflare.

This repository is configured out of the box to deploy to **`stats.houtini.ai`**.

---

## Why this exists

The official Plausible is a superb, open-source product — but it's a Phoenix
(Elixir) application that needs PostgreSQL for app data and ClickHouse for the
analytics firehose. None of that runs on Cloudflare Workers, which execute
short-lived V8 isolates at the edge. "Deploying Plausible on Cloudflare" in the
literal sense isn't possible.

So this project **re-implements Plausible's data contract natively for the
Cloudflare platform**. What you keep from Plausible:

- the exact tracking script behaviour and `<script data-domain=… src=…>` snippet,
- the `POST /api/event` ingestion contract (`n`/`u`/`d`/`r`/`w`/`h`/`p` fields),
- cookieless visitor counting via a **daily-rotating salted hash** (no IP stored),
- the metrics that matter: unique visitors, pageviews, visits, bounce rate,
  visit duration, top pages, sources (with UTM), countries, browsers, OS,
  devices, and custom goals.

What changes: the storage and compute layer is 100% Cloudflare.

## Architecture

```
        ┌────────────────────── Cloudflare Worker (stats.houtini.ai) ──────────────────────┐
        │                                                                                   │
 visitor│  GET /js/script.js   ──►  tracking script (Plausible drop-in)                     │
 ───────┼─►                                                                                 │
        │  POST /api/event     ──►  ingest.ts ──► enrich (UA, geo, source) ──► D1 (events)  │
        │                              │            identity.ts ──► KV (daily salt)          │
        │                              └────────────────────────────► D1 (sessions)         │
        │                                                                                   │
 you    │  GET /              ──►  dashboard (auth-gated)                                    │
 ───────┼─►  GET /api/stats/* ──►  stats.ts ──► aggregate queries over D1                    │
        │       (login via signed HttpOnly cookie, DASHBOARD_PASSWORD secret)               │
        └───────────────────────────────────────────────────────────────────────────────────┘
```

| Concern | Implementation |
| --- | --- |
| Compute | Cloudflare Worker (`src/`), zero runtime dependencies |
| Event & session storage | Cloudflare **D1** (`events` + `sessions` tables, `migrations/`) |
| Visitor-hash salt | Cloudflare **KV**, rotated every 24h (`src/identity.ts`) |
| Geolocation | `request.cf` (country/region/city) — no third-party lookup |
| Optional long-term store | Cloudflare **Analytics Engine** (dual-write, opt-in) |
| Dashboard | Server-rendered HTML + vanilla JS (`src/dashboard.ts`) |
| Auth | Single password → HMAC-signed cookie (`src/auth.ts`) |

### Source layout

```
src/
  index.ts       Router: public tracker + ingest, private dashboard + stats API
  tracker.ts     The client-side script served at /js/script.js
  ingest.ts      POST /api/event → enrich → sessionise → persist
  identity.ts    Daily-rotating salted visitor hashing (no IPs stored)
  enrich.ts      Dependency-free UA parsing, bot filter, source/UTM, screen size
  stats.ts       Read API: aggregate / timeseries / breakdown / current
  auth.ts        Password login + signed-cookie sessions
  dashboard.ts   Login page + analytics dashboard UI
  types.ts       Env bindings and shared types
migrations/
  0001_init.sql  D1 schema (events, sessions, indexes)
examples/
  demo.html      Copy-paste integration example
```

---

## Deploy to `stats.houtini.ai`

Prerequisites: a Cloudflare account with the **`houtini.ai` zone** already added,
and [Node.js](https://nodejs.org) 18+.

```bash
npm install
npx wrangler login
```

**1. Create the D1 database** and paste the printed `database_id` into
`wrangler.jsonc` (replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`):

```bash
npm run db:create           # wrangler d1 create plausible-for-cloudflare
```

**2. Create the KV namespace** and paste the printed `id` into `wrangler.jsonc`
(replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`):

```bash
npm run kv:create           # wrangler kv namespace create SALT_KV
```

**3. Apply the database schema** to the remote D1:

```bash
npm run db:migrate          # wrangler d1 migrations apply … --remote
```

**4. Set the two secrets** (dashboard password + cookie-signing key):

```bash
npx wrangler secret put DASHBOARD_PASSWORD   # you choose this
npx wrangler secret put AUTH_SECRET          # a long random string
```

**5. Deploy.** The `custom_domain` route provisions DNS + TLS for the subdomain
automatically:

```bash
npm run deploy              # wrangler deploy
```

Your dashboard is now live at **https://stats.houtini.ai** and the tracking
script at **https://stats.houtini.ai/js/script.js**.

### Add the snippet to the site you want to measure

```html
<script defer data-domain="houtini.ai" src="https://stats.houtini.ai/js/script.js"></script>
```

That's it. See [`examples/demo.html`](examples/demo.html) for custom events and
SPA notes. **Migrating from Plausible?** Change only the `src` host — everything
else in your snippet stays identical.

---

## Custom events (goals)

```js
// fires an event named "Signup" with a custom property
plausible('Signup', { props: { plan: 'pro' }, callback: () => console.log('sent') });
```

Custom events appear under **Goals & Custom Events** in the dashboard.

## Configuration (`wrangler.jsonc` → `vars`)

| Var | Meaning |
| --- | --- |
| `SITE_DOMAIN` | Domain whose events are accepted. Its subdomains are included. Set to `"*"` for multi-site mode. |
| `SITE_NAME` | Friendly name shown in the dashboard header. |

Secrets (`wrangler secret put`): `DASHBOARD_PASSWORD`, `AUTH_SECRET`.

Optional: uncomment the `analytics_engine_datasets` binding in `wrangler.jsonc`
to also mirror every event into Cloudflare Analytics Engine for unlimited,
SQL-queryable retention.

## Local development

```bash
# one-time: create local secrets
printf 'DASHBOARD_PASSWORD=devpass\nAUTH_SECRET=dev-secret\n' > .dev.vars
npm run db:migrate:local          # apply schema to the local D1
npm run dev                       # http://localhost:8787
```

Then open `http://localhost:8787`, sign in with `devpass`, and send a test
event:

```bash
curl -X POST http://localhost:8787/api/event -H 'Content-Type: text/plain' \
  --data '{"n":"pageview","u":"https://houtini.ai/","d":"houtini.ai","w":1280}'
```

## Privacy

- **No cookies** are used for tracking.
- **No IP addresses are stored.** A visitor id is `SHA-256(daily_salt | domain |
  ip | user-agent)`; the salt rotates every 24 hours and the previous salt is
  discarded, so the hash cannot be reversed or correlated across days.
- All processing happens within Cloudflare — no data is sent to any third party.

## HTTP API reference

Public (CORS-open):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/js/script.js` | Tracking script (also `script.hash.js`, etc.) |
| `POST` | `/api/event` | Ingest a pageview / custom event (Plausible-compatible) |

Private (require the dashboard session cookie):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Dashboard UI |
| `GET` | `/api/stats/current` | Live visitors (last 5 min) |
| `GET` | `/api/stats/aggregate?period=` | Top-line metrics |
| `GET` | `/api/stats/timeseries?period=` | Visitors/pageviews per bucket |
| `GET` | `/api/stats/breakdown?property=&period=&limit=` | Dimension breakdown |

`period` ∈ `day`, `7d`, `30d`, `month`, `6mo`, `12mo`.
`property` ∈ `page`, `entry_page`, `exit_page`, `source`, `referrer`,
`utm_source`, `utm_medium`, `utm_campaign`, `country`, `region`, `city`,
`browser`, `browser_version`, `os`, `os_version`, `device`, `screen_size`,
`goal`.

## Credits & licence

Tracking/API design is compatible with, and inspired by,
[Plausible Analytics](https://github.com/plausible/analytics) (AGPL-3.0). This is
an independent Cloudflare-native implementation of that contract, released under
the MIT licence (see [`LICENSE`](LICENSE)).
