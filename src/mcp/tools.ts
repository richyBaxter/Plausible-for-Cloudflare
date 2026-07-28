import type { Env } from "../types";
import {
  aggregate,
  compare,
  timeseries,
  breakdown,
  currentVisitors,
  funnel,
  recentEvents,
  parsePeriod,
  PERIODS,
  PROPERTIES,
} from "../stats";
import { listFunnels, getFunnelByName } from "../funnels";

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
  {
    name: "get_aggregate_comparison",
    description:
      "Top-line metrics for a period alongside the immediately-preceding period of the same length (e.g. this 7 days vs the previous 7 days), with the percentage change per metric. Use this to answer 'are we up or down vs last week?'.",
    inputSchema: {
      type: "object",
      properties: { period: periodProp, domain: domainProp },
      additionalProperties: false,
    },
  },
  {
    name: "get_funnel",
    description:
      "Ordered conversion funnel. Provide either `name` (a saved funnel) OR `steps` (2-8 ad-hoc steps, each a page path like '/pricing' or a custom event name like 'Signup'). Returns per-step visitor counts, conversion rate vs the first step, and drop-off. Steps are matched in time order per visitor.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of a saved funnel (see list_funnels). Alternative to `steps`." },
        steps: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 8,
          description: "Ordered funnel steps: page paths ('/checkout') or event names ('Purchase').",
        },
        period: periodProp,
        domain: domainProp,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_funnels",
    description: "List the saved funnel definitions (name + steps) available to get_funnel.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_events",
    description:
      "Most recent raw events (newest first), for inspecting live/recent activity. Optionally filter to a single event name (e.g. 'pageview' or a goal). Each row includes time, name, path, source, country, browser, OS, device and custom props.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Max events to return." },
        name: { type: "string", description: "Optional event-name filter, e.g. 'pageview' or a goal name." },
        period: periodProp,
        domain: domainProp,
      },
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
    case "get_aggregate_comparison":
      return compare(env, domain, period());
    case "list_funnels":
      return { funnels: await listFunnels(env) };
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
    case "get_funnel": {
      let steps: string[];
      let funnelName: string | undefined;
      if (typeof args.name === "string" && args.name) {
        const def = await getFunnelByName(env, args.name);
        if (!def) throw new Error(`No saved funnel named '${args.name}'. Use list_funnels to see available funnels.`);
        steps = def.steps;
        funnelName = def.name;
      } else {
        steps = Array.isArray(args.steps) ? args.steps.map((s) => String(s).trim()).filter(Boolean) : [];
      }
      if (steps.length < 2) throw new Error("Provide a saved funnel `name` or at least 2 `steps`.");
      return { name: funnelName, ...(await funnel(env, domain, period(), steps.slice(0, 8))) };
    }
    case "get_events": {
      const limit = clampInt(args.limit, 20, 1, 100);
      const eventName = typeof args.name === "string" && args.name ? args.name : undefined;
      return recentEvents(env, domain, period(), limit, eventName);
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
