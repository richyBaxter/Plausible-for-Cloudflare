# Contributing to Insights

Thanks for helping out. The whole project is a single Cloudflare Worker with
zero runtime dependencies — please keep it that way unless there's a very good
reason.

## Dev setup

```bash
npm install
printf 'DASHBOARD_PASSWORD=devpass\nAUTH_SECRET=dev-secret\nMCP_API_KEY=dev-mcp-token\n' > .dev.vars
npm run db:migrate:local
npm run dev            # http://localhost:8787
```

## Before you open a PR

```bash
npm run typecheck      # strict TS, no emit
npm test               # boots wrangler dev + runs the end-to-end smoke suite
```

Both must pass; CI runs exactly these plus a dry-run bundle. If you add a
feature, extend `scripts/smoke.sh` with assertions for it — the suite is
deliberately dependency-light (bash + node + curl).

## Ground rules

- **No runtime dependencies.** The Worker ships as one self-contained bundle.
- **Privacy is load-bearing.** Nothing may persist raw IPs or introduce
  cross-day visitor correlation. Changes to `src/identity.ts` get extra scrutiny.
- **Two ingestion dialects, one contract.** `POST /api/event` must keep
  accepting both the native payload and the Plausible-compatible one.
- Match the existing code style; comments explain *why*, not *what*.

## Reporting bugs

Open an issue with repro steps. For security issues, see [SECURITY.md](SECURITY.md).
