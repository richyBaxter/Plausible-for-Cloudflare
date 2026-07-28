import type { Env } from "./types";

/**
 * Privacy-preserving visitor identification, matching Plausible's approach.
 *
 * A visitor's id is a hash of (daily salt + domain + ip + user-agent). The salt
 * rotates every 24h and old salts are discarded, so the hash cannot be linked
 * back to an IP after rotation and cannot be correlated across days. Raw IP
 * addresses are never written to the database.
 */

const SALT_KEY_TODAY = "salt:today";
const SALT_KEY_YESTERDAY = "salt:yesterday";
const DAY_SECONDS = 86_400;

interface SaltPair {
  today: string;
  yesterday: string | null;
}

/** Fetch (or lazily create + rotate) the salt pair from KV. */
export async function getSalts(env: Env): Promise<SaltPair> {
  const now = Math.floor(Date.now() / 1000);
  const stored = await env.SALT_KV.get<{ value: string; created: number }>(SALT_KEY_TODAY, "json");

  if (stored && now - stored.created < DAY_SECONDS) {
    const yesterday = await env.SALT_KV.get(SALT_KEY_YESTERDAY);
    return { today: stored.value, yesterday };
  }

  // Rotate: today's salt becomes yesterday's, and we mint a fresh one.
  const fresh = randomSalt();
  if (stored) {
    await env.SALT_KV.put(SALT_KEY_YESTERDAY, stored.value, { expirationTtl: 2 * DAY_SECONDS });
  }
  await env.SALT_KV.put(SALT_KEY_TODAY, JSON.stringify({ value: fresh, created: now }));
  const yesterday = stored ? stored.value : null;
  return { today: fresh, yesterday };
}

function randomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute a stable visitor id for this event. We try today's salt first; if the
 * visitor already has an active session hashed with yesterday's salt (i.e. their
 * visit straddled the rotation boundary) the ingester will still stitch it using
 * the returned `yesterdayUserId`.
 */
export async function visitorId(
  env: Env,
  domain: string,
  ip: string,
  userAgent: string,
): Promise<{ userId: string; yesterdayUserId: string | null }> {
  const { today, yesterday } = await getSalts(env);
  const userId = await sha256Hex(`${today}|${domain}|${ip}|${userAgent}`);
  const yesterdayUserId = yesterday
    ? await sha256Hex(`${yesterday}|${domain}|${ip}|${userAgent}`)
    : null;
  return { userId, yesterdayUserId };
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
