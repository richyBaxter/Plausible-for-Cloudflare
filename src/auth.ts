import type { Env } from "./types";

/**
 * Minimal but real session auth for the dashboard. A single shared password
 * (the DASHBOARD_PASSWORD secret) unlocks a signed, HttpOnly cookie. The cookie
 * value is `<expiry>.<hmac>` where the HMAC is keyed by the AUTH_SECRET secret,
 * so it cannot be forged and expires on its own. Ingestion and the tracking
 * script stay public — only the dashboard and stats API require this.
 */

const COOKIE = "pfc_session";
const TTL = 60 * 60 * 24 * 14; // 14 days

export async function isAuthed(req: Request, env: Env): Promise<boolean> {
  // Fail closed on an unconfigured deployment: without AUTH_SECRET the HMAC key
  // would be empty/predictable and a session cookie could be forged.
  if (!env.AUTH_SECRET || !env.DASHBOARD_PASSWORD) return false;
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = parseInt(expStr, 10);
  if (!expStr || !sig || Number.isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(env.AUTH_SECRET, expStr);
  return timingSafeEqual(sig, expected);
}

export async function login(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  // Both secrets must be configured before login is possible (see isAuthed).
  if (!env.DASHBOARD_PASSWORD || !env.AUTH_SECRET || !timingSafeEqual(password, env.DASHBOARD_PASSWORD)) {
    return redirect("/login?error=1");
  }
  const exp = Math.floor(Date.now() / 1000) + TTL;
  const sig = await hmac(env.AUTH_SECRET, String(exp));
  const cookie = `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL}`;
  return new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookie } });
}

export function logout(): Response {
  return new Response(null, {
    status: 302,
    headers: { location: "/login", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** Constant-time string comparison to avoid leaking length/prefix via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
