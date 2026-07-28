# Insights

A privacy-friendly, cookieless web-analytics platform that runs **entirely on the
Cloudflare edge** — a single Worker backed by **D1** (SQLite) and **KV**, with a
clean native API, a **Plausible-compatible** ingestion shim, and a built-in
**MCP server** so AI clients like Claude can query your stats in natural language.

No servers, no containers, no cold starts, generous free tier, and your visitors'
data never leaves Cloudflare. This repository is configured out of the box to
deploy to **`stats.houtini.ai`**.

> **Lineage.** Insights began as "Plausible-for-Cloudflare". The official
> [Plausible Analytics](https://github.com/plausible/analytics) is an excellent
> open-source product, but it's an Elixir/Phoenix app requiring PostgreSQL +
> ClickHouse — none of which run on Cloudflare Workers (short-lived V8 isolates).
> So Insights is an independent, Cloudflare-native re-implementation of that
> data contract. It keeps Plausible wire-compatibility at the tracking boundary
> (migrate by changing only the script `src`) while owning a cleaner native API
> for new projects.

---

## What you get

- **Native tracking script** at `/insights.js` with a readable payload and a
  `window.insights('Event', { props })` API.
- **Drop-in Plausible compatibility** at `/js/script.js` — existing Plausible
  snippets, plugins, and integrations work by only changing the `src` host.
- **One ingestion endpoint** (`POST /api/event`) that accepts **both** payload
  formats.
- **Cookieless, IP-free visitor counting** via a daily-rotating salted hash.
- The metrics that matter: unique visitors, pageviews, visits, bounce rate,
  visit duration, top pages, sources (with UTM), countries, regions, cities,
  browsers, OS, devices, screen sizes, and custom goals.
- A **built-in dashboard** with password login.
- A **remote MCP server** at `/mcp` exposing the analytics as tools for Claude
  and other MCP clients.

## Architecture

```
        ┌──────────────────────── Cloudflare Worker (stats.houtini.ai) ────────────────────────┐
        │                                                                                       │
 visitor│  GET /insights.js · /js/script.js  ──►  tracking scripts (native + Plausible-compat)  │
 ───────┼─►                                                                                     │
        │  POST /api/event  ──►  ingest.ts ──► enrich (UA, geo, source) ──► D1 (events)         │
        │                          │            identity.ts ──► KV (daily salt)                  │
        │                          └──────────────────────────────► D1 (sessions)               │
        │                                                                                       │
 you    │  GET /             ──►  dashboard (auth-gated)                                         │
 ───────┼─►  GET /api/stats/* ──►  stats.ts ──► aggregate queries over D1                        │
        │                                                                                       │
 Claude │  POST /mcp         ──►  mcp/server.ts ──► mcp/tools.ts ──► stats.ts (bearer auth)      │
 ───────┼─►                                                                                     │
        └───────────────────────────────────────────────────────────────────────────────────────┘
```

| Concern | Implementation |
| --- | --- |
| Compute | Cloudflare Worker (`src/`), zero runtime dependencies |
| Event & session storage | Cloudflare **D1** (`events` + `sessions`, `migrations/`) |
| Visitor-hash salt | Cloudflare **KV**, rotated every 24h (`src/identity.ts`) |
| Geolocation | `request.cf` (country/region/city) — no third-party lookup |
| AI access | Remote **MCP** server (`src/mcp/`) over JSON-RPC / Streamable HTTP |
| Optional long-term store | Cloudflare **Analytics Engine** (opt-in dual-write) |
| Dashboard | Server-rendered HTML + vanilla JS (`src/dashboard.ts`) |
| Auth | Password → HMAC-signed cookie (dashboard); bearer token (MCP) |

### Source layout

```
src/
  index.ts        Router: tracking scripts, ingest, dashboard, stats API, MCP
  tracker.ts      Client scripts served at /insights.js and /js/script.js
  ingest.ts       POST /api/event → normalise (native + Plausible) → sessionise → persist
  identity.ts     Daily-rotating salted visitor hashing (no IPs stored)
  enrich.ts       Dependency-free UA parsing, bot filter, source/UTM, screen size
  stats.ts        Query functions: aggregate / timeseries / breakdown / current
  auth.ts         Password login + signed-cookie sessions
  dashboard.ts    Login page + analytics dashboard UI
  types.ts        Env bindings and shared types
  mcp/
    server.ts     JSON-RPC 2.0 MCP server (Streamable HTTP), bearer-authenticated
    tools.ts      Tool definitions + dispatch onto the stats query functions
migrations/
  0001_init.sql   D1 schema (events, sessions, indexes)
examples/
  demo.html       Copy-paste integration example
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
npm run db:create           # wrangler d1 create insights
```

**2. Create the KV namespace** and paste the printed `id` into `wrangler.jsonc`
(replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`):

```bash
npm run kv:create           # wrangler kv namespace create SALT_KV
```

**3. Apply the database schema** to the remote D1:

```bash
npm run db:migrate          # wrangler d1 migrations apply insights --remote
```

**4. Set the secrets:**

```bash
npx wrangler secret put DASHBOARD_PASSWORD   # dashboard login password
npx wrangler secret put AUTH_SECRET          # a long random string (cookie signing)
npx wrangler secret put MCP_API_KEY          # bearer token for the MCP server (optional)
```

If you don't set `MCP_API_KEY`, `/mcp` stays disabled and returns 503.

**5. Deploy.** The `custom_domain` route provisions DNS + TLS automatically:

```bash
npm run deploy              # wrangler deploy
```

Dashboard: **https://stats.houtini.ai** · Scripts:
**/insights.js** and **/js/script.js** · MCP: **/mcp**.

### Add tracking to your site

Native:

```html
<script defer data-domain="houtini.ai" src="https://stats.houtini.ai/insights.js"></script>
```

Or, if you're **migrating from Plausible**, change only the `src` host:

```html
<script defer data-domain="houtini.ai" src="https://stats.houtini.ai/js/script.js"></script>
```

See [`examples/demo.html`](examples/demo.html) for custom events and SPA notes.

---

## Custom events (goals)

```js
insights('Signup', { props: { plan: 'pro' }, callback: () => console.log('sent') });
// plausible('Signup', { props: { plan: 'pro' } }) also works — same function.
```

Custom events appear under **Goals & Custom Events** in the dashboard and via the
`get_breakdown` MCP tool with `property: "goal"`.

## Connect Claude (or any MCP client)

The Worker exposes a remote MCP server at `POST /mcp`. Add it as a custom/remote
MCP server:

- **URL:** `https://stats.houtini.ai/mcp`
- **Header:** `Authorization: Bearer <your MCP_API_KEY>`

Tools exposed:

| Tool | Arguments | Returns |
| --- | --- | --- |
| `get_current_visitors` | — | live visitors (last 5 min) |
| `get_aggregate_stats` | `period` | visitors, pageviews, visits, bounce rate, duration |
| `get_timeseries` | `period` | visitors/pageviews per time bucket |
| `get_breakdown` | `property`, `period`, `limit` | top values for a dimension |

`period` ∈ `day`, `7d`, `30d`, `month`, `6mo`, `12mo`. `property` ∈ `page`,
`entry_page`, `exit_page`, `source`, `referrer`, `utm_source`, `utm_medium`,
`utm_campaign`, `country`, `region`, `city`, `browser`, `browser_version`,
`os`, `os_version`, `device`, `screen_size`, `goal`.

Then just ask: *"How many visitors did houtini.ai get this week, and what were
the top traffic sources?"*

Quick check with curl:

```bash
curl -s https://stats.houtini.ai/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_aggregate_stats","arguments":{"period":"7d"}}}'
```

---

## Configuration (`wrangler.jsonc` → `vars`)

| Var | Meaning |
| --- | --- |
| `SITE_DOMAIN` | Domain whose events are accepted (subdomains included). `"*"` = multi-site mode. |
| `SITE_NAME` | Friendly name shown in the dashboard header. |

Secrets: `DASHBOARD_PASSWORD`, `AUTH_SECRET`, `MCP_API_KEY` (optional).

Optional: uncomment the `analytics_engine_datasets` binding in `wrangler.jsonc`
to also mirror every event into Cloudflare Analytics Engine for unlimited,
SQL-queryable retention.

## HTTP API reference

Public (CORS-open):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/insights.js` | Native tracking script |
| `GET` | `/js/script.js` | Plausible-compatible tracking script |
| `POST` | `/api/event` | Ingest a pageview / custom event (native **or** Plausible payload) |
| `POST` | `/mcp` | MCP server (bearer-authenticated) |

Native payload:

```json
{ "event": "pageview", "url": "https://houtini.ai/", "domain": "houtini.ai",
  "referrer": "https://news.ycombinator.com/", "viewport": 1440,
  "props": { "any": "value" } }
```

Private (require the dashboard session cookie):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Dashboard UI |
| `GET` | `/api/stats/current` | Live visitors (last 5 min) |
| `GET` | `/api/stats/aggregate?period=` | Top-line metrics |
| `GET` | `/api/stats/timeseries?period=` | Visitors/pageviews per bucket |
| `GET` | `/api/stats/breakdown?property=&period=&limit=` | Dimension breakdown |

## Local development

```bash
printf 'DASHBOARD_PASSWORD=devpass\nAUTH_SECRET=dev-secret\nMCP_API_KEY=dev-mcp-token\n' > .dev.vars
npm run db:migrate:local          # apply schema to the local D1
npm run dev                       # http://localhost:8787
```

Send a test event and query it back:

```bash
curl -X POST http://localhost:8787/api/event -H 'Content-Type: text/plain' \
  --data '{"event":"pageview","url":"https://houtini.ai/","domain":"houtini.ai","viewport":1280}'

curl http://localhost:8787/mcp -H "Authorization: Bearer dev-mcp-token" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_aggregate_stats","arguments":{}}}'
```

## Privacy

- **No cookies** are used for tracking.
- **No IP addresses are stored.** A visitor id is `SHA-256(daily_salt | domain |
  ip | user-agent)`; the salt rotates every 24 hours and the previous salt is
  discarded, so the hash cannot be reversed or correlated across days.
- All processing happens within Cloudflare — no data is sent to any third party.

## Credits & licence

Tracking/API design is compatible with, and inspired by,
[Plausible Analytics](https://github.com/plausible/analytics) (AGPL-3.0). Insights
is an independent Cloudflare-native implementation of that contract, released
under the MIT licence (see [`LICENSE`](LICENSE)).
