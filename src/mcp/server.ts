import type { Env } from "../types";
import { TOOLS, callTool } from "./tools";

/**
 * A self-contained remote MCP server at POST /mcp, implementing the
 * Model Context Protocol over the Streamable HTTP transport as plain
 * JSON-RPC 2.0 — no SDK, no dependencies.
 *
 * It is stateless (no session id needed) and tools-only, so it never needs to
 * push messages to the client; every POST gets a single JSON response. Clients
 * authenticate with `Authorization: Bearer <MCP_API_KEY>`.
 *
 * Connect from Claude by adding a custom/remote MCP server:
 *   URL:    https://stats.houtini.ai/mcp
 *   Header: Authorization: Bearer <your MCP_API_KEY>
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "insights", version: "1.0.0" };

export async function handleMcp(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  // The optional server→client SSE stream isn't needed for a tools-only server.
  if (req.method === "GET") return cors(text("Method Not Allowed", 405));
  if (req.method !== "POST") return cors(text("Method Not Allowed", 405));

  if (!env.MCP_API_KEY) {
    return cors(json({ error: "MCP server disabled. Set the MCP_API_KEY secret to enable it." }, 503));
  }

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !timingSafeEqual(token, env.MCP_API_KEY)) {
    return cors(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="insights-mcp"' },
      }),
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return cors(json(rpcError(null, -32700, "Parse error"), 200));
  }

  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as JsonRpcMessage[];
  const responses: JsonRpcResponse[] = [];
  for (const msg of messages) {
    const res = await handleMessage(env, msg);
    if (res) responses.push(res);
  }

  // A batch of pure notifications produces no responses → 202 Accepted.
  if (responses.length === 0) return cors(new Response(null, { status: 202 }));
  return cors(json(batch ? responses : responses[0], 200));
}

// --------------------------------------------------------------------------- //

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

async function handleMessage(env: Env, msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined || msg.id === null;
  const method = msg.method ?? "";

  // Notifications (e.g. notifications/initialized) get no response.
  if (isNotification) return null;
  const id = msg.id as string | number;

  switch (method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return ok(id, {
        protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Insights web-analytics for this site. Use get_aggregate_stats for top-line numbers, get_timeseries for trends, get_breakdown for top pages/sources/countries/etc, and get_current_visitors for realtime.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      try {
        const result = await callTool(env, name, args);
        // MCP convention: tool-level failures are reported via isError, not a JSON-RPC error.
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return ok(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function ok(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}
function cors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "POST, GET, OPTIONS");
  h.set("access-control-allow-headers", "authorization, content-type, mcp-session-id, mcp-protocol-version");
  h.set("access-control-max-age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
