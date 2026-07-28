import type { Env } from "./types";

/**
 * CRUD for saved funnel definitions (the `funnels` table). A definition is just
 * a name + an ordered list of step strings; computing the actual conversion
 * numbers lives in stats.ts (funnel()), which these steps feed into.
 */

export interface FunnelDef {
  id: number;
  name: string;
  steps: string[];
  created: number;
}

export async function listFunnels(env: Env): Promise<FunnelDef[]> {
  const rows = await env.DB.prepare(
    `SELECT id, name, steps, created FROM funnels ORDER BY name ASC`,
  ).all<{ id: number; name: string; steps: string; created: number }>();
  return rows.results.map((r) => ({ id: r.id, name: r.name, steps: safeSteps(r.steps), created: r.created }));
}

export async function getFunnelByName(env: Env, name: string): Promise<FunnelDef | null> {
  const r = await env.DB.prepare(`SELECT id, name, steps, created FROM funnels WHERE name = ?`)
    .bind(name)
    .first<{ id: number; name: string; steps: string; created: number }>();
  return r ? { id: r.id, name: r.name, steps: safeSteps(r.steps), created: r.created } : null;
}

/** Create or update a funnel by name (idempotent upsert). */
export async function saveFunnel(env: Env, name: string, steps: string[]): Promise<FunnelDef> {
  const clean = steps.map((s) => String(s).trim()).filter(Boolean).slice(0, 8);
  if (!name.trim()) throw new Error("Funnel name is required.");
  if (clean.length < 2) throw new Error("A funnel needs at least 2 steps.");
  const created = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO funnels (name, steps, created) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET steps = excluded.steps`,
  )
    .bind(name.trim(), JSON.stringify(clean), created)
    .run();
  return (await getFunnelByName(env, name.trim()))!;
}

export async function deleteFunnel(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM funnels WHERE id = ?`).bind(id).run();
}

function safeSteps(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Auth-gated management API for funnel definitions:
 *   GET    /api/funnels           → list
 *   POST   /api/funnels           → create/update { name, steps: string[] | "a,b,c" }
 *   DELETE /api/funnels?id=N       → delete
 */
export async function handleFunnels(req: Request, url: URL, env: Env): Promise<Response> {
  const method = req.method.toUpperCase();

  if (method === "GET") return json(await listFunnels(env));

  if (method === "POST") {
    let body: { name?: string; steps?: unknown };
    try {
      body = (await req.json()) as { name?: string; steps?: unknown };
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }
    const steps = Array.isArray(body.steps)
      ? body.steps.map(String)
      : String(body.steps ?? "").split(",");
    try {
      return json(await saveFunnel(env, String(body.name ?? ""), steps), 201);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }

  if (method === "DELETE") {
    const id = parseInt(url.searchParams.get("id") ?? "", 10);
    if (Number.isNaN(id)) return json({ error: "id required" }, 400);
    await deleteFunnel(env, id);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
