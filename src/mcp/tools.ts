import type { Env } from "../types";
import {
  aggregate,
  timeseries,
  breakdown,
  currentVisitors,
  parsePeriod,
  PERIODS,
  PROPERTIES,
} from "../stats";

/**
 * The Insights analytics data, exposed as MCP tools so Claude (or any MCP client)
 * can answer questions like "how many visitors this week?" or "what are my top
 * referrers this month?" in natural language.
 *
 * Each tool maps directly onto the same query functions the dashboard uses.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const periodProp = {
  type: "string",
  enum: [...PERIODS],
  default: "7d",
  description: "Time range for the query.",
};

const domainProp = {
  type: "string",
  description: "Site domain. Only needed in multi-site mode (SITE_DOMAIN='*'); ignored otherwise.",
};

export const TOOLS: McpTool[] = [
  {
    name: "get_current_visitors",
    description: "Number of unique visitors active on the site in the last 5 minutes (realtime).",
    inputSchema: { type: "object", properties: { domain: domainProp }, additionalProperties: false },
  },
  {
    name: "get_aggregate_stats",
    description:
      "Top-line metrics for a period: unique visitors, total pageviews, visits, bounce rate (%) and average visit duration (seconds).",
    inputSchema: {
      type: "object",
      properties: { period: periodProp, domain: domainProp },
      additionalProperties: false,
    },
  },
  {
    name: "get_timeseries",
    description:
      "Visitors and pageviews over time for a period, bucketed by hour (today), day (7d/30d/month) or month (6mo/12mo). Useful for spotting trends.",
    inputSchema: {
      type: "object",
      properties: { period: periodProp, domain: domainProp },
      additionalProperties: false,
    },
  },
  {
    name: "get_breakdown",
    description:
      "Top values for a single dimension over a period, each with its visitor count (and pageviews for pages/goals). Use this for top pages, traffic sources, countries, browsers, devices, custom goals, etc.",
    inputSchema: {
      type: "object",
      properties: {
        property: {
          type: "string",
          enum: PROPERTIES,
          description: "The dimension to break down by.",
        },
        period: periodProp,
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10, description: "Max rows to return." },
        domain: domainProp,
      },
      required: ["property"],
      additionalProperties: false,
    },
  },
];

/** Resolve which site a tool call targets. */
function resolveDomain(env: Env, args: Record<string, unknown>): string {
  if (env.SITE_DOMAIN && env.SITE_DOMAIN !== "*") return env.SITE_DOMAIN;
  const d = typeof args.domain === "string" ? args.domain : "";
  if (!d) throw new Error("This instance is in multi-site mode; a 'domain' argument is required.");
  return d.toLowerCase();
}

/** Execute a tool by name and return a JSON-serialisable result. */
export async function callTool(env: Env, name: string, args: Record<string, unknown>): Promise<unknown> {
  const domain = resolveDomain(env, args);
  const period = () => parsePeriod(typeof args.period === "string" ? args.period : "7d");

  switch (name) {
    case "get_current_visitors":
      return currentVisitors(env, domain);
    case "get_aggregate_stats":
      return aggregate(env, domain, period());
    case "get_timeseries":
      return timeseries(env, domain, period());
    case "get_breakdown": {
      const property = String(args.property ?? "");
      if (!PROPERTIES.includes(property)) {
        throw new Error(`Unknown property '${property}'. Valid: ${PROPERTIES.join(", ")}`);
      }
      const limit = clampInt(args.limit, 10, 1, 100);
      return breakdown(env, domain, period(), property, limit);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
