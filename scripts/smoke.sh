#!/usr/bin/env bash
#
# End-to-end smoke test for Insights.
#
# Boots `wrangler dev` against a local D1, seeds a deterministic set of events,
# and asserts the tracking scripts, ingestion (native + Plausible payloads),
# dashboard auth, the stats API (aggregate / breakdown / funnel / events), and
# the MCP server (handshake, auth, tool calls) all behave correctly.
#
# Usage: bash scripts/smoke.sh   (override port with PORT=8801 bash scripts/smoke.sh)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8799}"
DB="insights"
PASS="smoke-pass"
SECRET="smoke-secret-0123456789"
MCP="smoke-mcp-token"
B="http://localhost:$PORT"
LOG="$(mktemp)"
COOKIES="$(mktemp)"

PASSED=0
FAILED=0
pass() { echo "  ✓ $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  ✗ $1"; FAILED=$((FAILED + 1)); }
assert_eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 — expected [$3], got [$2]"; fi; }
assert_has() { if printf '%s' "$2" | grep -q -- "$3"; then pass "$1"; else fail "$1 — missing [$3] in: $(printf '%s' "$2" | head -c 200)"; fi; }

# Extract a (possibly nested) field from JSON on stdin. Path uses dots: "steps.0.visitors".
json_get() {
  node -e '
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
    let v = d;
    for (const k of process.argv[1].split(".")) v = (v == null ? undefined : v[k]);
    process.stdout.write(v === undefined ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
  ' "$1"
}

DEV_PID=""
cleanup() {
  [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null
  pkill -f "wrangler dev --port $PORT" 2>/dev/null
  pkill -f "workerd.*entry=localhost:$PORT" 2>/dev/null
  rm -f "$LOG" "$COOKIES"
}
trap cleanup EXIT

echo "==> Applying local D1 migrations"
npx wrangler d1 migrations apply "$DB" --local >/dev/null 2>&1 || { echo "migration failed"; exit 1; }

# Reset the local dataset so exact-count assertions are deterministic across reruns
# (a CI checkout starts empty; local dev keeps the D1 file between runs).
echo "==> Resetting local dataset"
npx wrangler d1 execute "$DB" --local \
  --command "DELETE FROM events; DELETE FROM sessions; DELETE FROM funnels;" >/dev/null 2>&1 || true

echo "==> Starting wrangler dev on :$PORT"
npx wrangler dev --port "$PORT" --local \
  --var "DASHBOARD_PASSWORD:$PASS" --var "AUTH_SECRET:$SECRET" --var "MCP_API_KEY:$MCP" \
  >"$LOG" 2>&1 &
DEV_PID=$!

for _ in $(seq 1 120); do
  grep -q "Ready on http" "$LOG" && break
  kill -0 "$DEV_PID" 2>/dev/null || { echo "dev server exited early:"; cat "$LOG"; exit 1; }
  sleep 0.5
done
grep -q "Ready on http" "$LOG" || { echo "timed out waiting for dev server:"; cat "$LOG"; exit 1; }

# --- helpers ---------------------------------------------------------------- #
UA_A="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
UA_B="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
post_status() { # ua ip json  -> prints HTTP status
  curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/event" \
    -H "Content-Type: text/plain" -H "User-Agent: $1" -H "CF-Connecting-IP: $2" --data "$3"
}
mcp() { # json -> prints response body
  curl -s -X POST "$B/mcp" -H "Authorization: Bearer $MCP" -H "Content-Type: application/json" --data "$1"
}

echo "==> Seeding events"
# Visitor B first (drops out of the funnel after step 1) — native payload.
assert_eq "native payload accepted (visitor B /pricing)" \
  "$(post_status "$UA_B" 4.4.4.4 '{"event":"pageview","url":"https://houtini.ai/pricing","domain":"houtini.ai","viewport":1440}')" 202
sleep 0.4
# Visitor A completes the whole funnel: /pricing (native) -> /signup (legacy) -> Signup (native custom).
assert_eq "native payload accepted (visitor A /pricing)" \
  "$(post_status "$UA_A" 3.3.3.3 '{"event":"pageview","url":"https://houtini.ai/pricing?utm_source=newsletter","domain":"houtini.ai","viewport":1280}')" 202
sleep 0.4
assert_eq "legacy Plausible payload accepted (visitor A /signup)" \
  "$(post_status "$UA_A" 3.3.3.3 '{"n":"pageview","u":"https://houtini.ai/signup","d":"houtini.ai","w":1280}')" 202
sleep 0.4
assert_eq "custom event accepted (visitor A Signup)" \
  "$(post_status "$UA_A" 3.3.3.3 '{"event":"Signup","url":"https://houtini.ai/signup","domain":"houtini.ai","props":{"plan":"pro"}}')" 202
sleep 0.4
assert_eq "bot event dropped (still 202)" \
  "$(post_status "Googlebot/2.1 (+http://www.google.com/bot.html)" 5.5.5.5 '{"event":"pageview","url":"https://houtini.ai/","domain":"houtini.ai"}')" 202
assert_eq "wrong domain rejected (403)" \
  "$(post_status "$UA_B" 6.6.6.6 '{"event":"pageview","url":"https://evil.com/","domain":"evil.com"}')" 403
sleep 1   # let ctx.waitUntil writes settle

echo "==> Tracking scripts"
assert_eq  "GET /insights.js is 200"        "$(curl -s -o /dev/null -w '%{http_code}' "$B/insights.js")" 200
assert_has "GET /insights.js is the script" "$(curl -s "$B/insights.js")" "window.insights"
assert_has "GET /js/script.js (Plausible)"  "$(curl -s "$B/js/script.js")" "window.plausible"

echo "==> Auth"
assert_eq "stats without auth -> 401" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/stats/aggregate")" 401
assert_eq "login sets a session" \
  "$(curl -s -c "$COOKIES" -o /dev/null -w '%{http_code}' -X POST "$B/login" --data "password=$PASS")" 302
AUTH=(-b "$COOKIES")

echo "==> Stats API"
AGG="$(curl -s "${AUTH[@]}" "$B/api/stats/aggregate?period=day")"
assert_eq "aggregate: 2 unique visitors"  "$(printf '%s' "$AGG" | json_get visitors)"   2
assert_eq "aggregate: 3 pageviews"        "$(printf '%s' "$AGG" | json_get pageviews)"  3
assert_eq "aggregate: 2 visits"           "$(printf '%s' "$AGG" | json_get visits)"     2
assert_eq "aggregate: 50% bounce rate"    "$(printf '%s' "$AGG" | json_get bounce_rate)" 50

PAGES="$(curl -s "${AUTH[@]}" "$B/api/stats/breakdown?property=page&period=day")"
assert_has "breakdown pages includes /pricing" "$PAGES" "/pricing"

FUN="$(curl -s "${AUTH[@]}" "$B/api/stats/funnel?period=day&steps=/pricing,/signup,Signup")"
assert_eq "funnel: 2 entered"                 "$(printf '%s' "$FUN" | json_get entered)"              2
assert_eq "funnel step1 (/pricing) visitors"  "$(printf '%s' "$FUN" | json_get steps.0.visitors)"     2
assert_eq "funnel step2 (/signup) visitors"   "$(printf '%s' "$FUN" | json_get steps.1.visitors)"     1
assert_eq "funnel step3 (Signup) visitors"    "$(printf '%s' "$FUN" | json_get steps.2.visitors)"     1
assert_eq "funnel step2 conversion is 50%"    "$(printf '%s' "$FUN" | json_get steps.1.conversion_rate)" 50

EVENTS="$(curl -s "${AUTH[@]}" "$B/api/stats/events?period=day&limit=50")"
assert_has "raw events export includes Signup" "$EVENTS" "Signup"

CMP="$(curl -s "${AUTH[@]}" "$B/api/stats/compare?period=day")"
assert_eq "compare: current visitors is 2"      "$(printf '%s' "$CMP" | json_get current.visitors)"  2
assert_eq "compare: previous visitors is 0"     "$(printf '%s' "$CMP" | json_get previous.visitors)" 0
assert_eq "compare: no baseline -> null change" "$(printf '%s' "$CMP" | json_get change.visitors)"   "null"

echo "==> Saved funnels"
CREATE="$(curl -s "${AUTH[@]}" -o /dev/null -w '%{http_code}' -X POST "$B/api/funnels" \
  -H 'Content-Type: application/json' --data '{"name":"Signup flow","steps":["/pricing","/signup","Signup"]}')"
assert_eq "create saved funnel -> 201" "$CREATE" 201
assert_has "list funnels includes it" "$(curl -s "${AUTH[@]}" "$B/api/funnels")" "Signup flow"
NAMED="$(curl -s "${AUTH[@]}" "$B/api/stats/funnel?name=Signup%20flow&period=day")"
assert_eq "saved funnel computes: 2 entered" "$(printf '%s' "$NAMED" | json_get entered)" 2
assert_eq "saved funnel echoes its name"     "$(printf '%s' "$NAMED" | json_get name)" "Signup flow"

echo "==> MCP server"
assert_eq "MCP without token -> 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/mcp" -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')" 401

INIT="$(mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}')"
assert_eq "MCP initialize serverInfo.name" "$(printf '%s' "$INIT" | json_get result.serverInfo.name)" "insights"

TOOLS="$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"
assert_eq "MCP exposes 8 tools" "$(printf '%s' "$TOOLS" | json_get result.tools | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).length)')" 8

CALL="$(mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_funnel","arguments":{"period":"day","steps":["/pricing","/signup","Signup"]}}}')"
CALL_TEXT="$(printf '%s' "$CALL" | json_get result.content.0.text)"
assert_eq "MCP get_funnel (ad-hoc) returns 2 entered" "$(printf '%s' "$CALL_TEXT" | json_get entered)" 2

NAMEDCALL="$(mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_funnel","arguments":{"period":"day","name":"Signup flow"}}}')"
assert_eq "MCP get_funnel (by saved name) returns 2 entered" \
  "$(printf '%s' "$NAMEDCALL" | json_get result.content.0.text | json_get entered)" 2

LISTF="$(mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"list_funnels","arguments":{}}}')"
assert_has "MCP list_funnels includes saved funnel" "$(printf '%s' "$LISTF" | json_get result.content.0.text)" "Signup flow"

CMPCALL="$(mcp '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"get_aggregate_comparison","arguments":{"period":"day"}}}')"
assert_eq "MCP get_aggregate_comparison current visitors" \
  "$(printf '%s' "$CMPCALL" | json_get result.content.0.text | json_get current.visitors)" 2

BADCALL="$(mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_breakdown","arguments":{"property":"nope"}}}')"
assert_eq "MCP tool error surfaces isError" "$(printf '%s' "$BADCALL" | json_get result.isError)" "true"

UNKNOWN="$(mcp '{"jsonrpc":"2.0","id":5,"method":"no/such/method"}')"
assert_eq "MCP unknown method -> -32601" "$(printf '%s' "$UNKNOWN" | json_get error.code)" "-32601"

echo ""
echo "================ $PASSED passed, $FAILED failed ================"
[ "$FAILED" -eq 0 ]
