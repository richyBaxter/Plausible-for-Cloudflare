/**
 * Lightweight, dependency-free enrichment: User-Agent parsing, bot detection,
 * referrer-source and UTM derivation, and screen-size bucketing. This mirrors the
 * dimensions Plausible reports without shipping a heavy UA database to the edge.
 */

export interface UaInfo {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  device: string; // 'Desktop' | 'Mobile' | 'Tablet'
  isBot: boolean;
}

const BOT_RE =
  /(bot|crawl|spider|slurp|bing|yandex|baidu|duckduck|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|slack|discord|preview|headless|lighthouse|pagespeed|gtmetrix|monitor|curl|wget|python-requests|axios|node-fetch|go-http|okhttp|java\/|ahrefs|semrush|mj12|dotbot|petalbot|applebot|google-inspection)/i;

export function parseUserAgent(ua: string): UaInfo {
  if (!ua) {
    return { browser: null, browserVersion: null, os: null, osVersion: null, device: "Desktop", isBot: true };
  }
  const isBot = BOT_RE.test(ua);

  // --- OS ---
  let os: string | null = null;
  let osVersion: string | null = null;
  if (/windows nt/i.test(ua)) {
    os = "Windows";
    const m = ua.match(/windows nt ([\d.]+)/i);
    osVersion = m ? windowsVersion(m[1]) : null;
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    os = "iOS";
    const m = ua.match(/os ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, ".") : null;
  } else if (/mac os x/i.test(ua)) {
    os = "macOS";
    const m = ua.match(/mac os x ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, ".") : null;
  } else if (/android/i.test(ua)) {
    os = "Android";
    const m = ua.match(/android ([\d.]+)/i);
    osVersion = m ? m[1] : null;
  } else if (/cros/i.test(ua)) {
    os = "Chrome OS";
  } else if (/linux/i.test(ua)) {
    os = "Linux";
  }

  // --- Browser (order matters: check derivatives before their base engine) ---
  let browser: string | null = null;
  let browserVersion: string | null = null;
  const b = (name: string, re: RegExp) => {
    const m = ua.match(re);
    if (m) {
      browser = name;
      browserVersion = m[1] ?? null;
    }
    return !!m;
  };
  // eslint-disable-next-line no-unused-expressions
  b("Edge", /edg(?:e|a|ios)?\/([\d.]+)/i) ||
    b("Samsung Internet", /samsungbrowser\/([\d.]+)/i) ||
    b("Opera", /(?:opr|opera)\/([\d.]+)/i) ||
    b("Vivaldi", /vivaldi\/([\d.]+)/i) ||
    b("Firefox", /(?:firefox|fxios)\/([\d.]+)/i) ||
    b("Chrome", /(?:chrome|crios)\/([\d.]+)/i) ||
    b("Safari", /version\/([\d.]+).*safari/i) ||
    b("Internet Explorer", /(?:msie |rv:)([\d.]+)/i);

  // --- Device class ---
  let device = "Desktop";
  if (/ipad|tablet|kindle|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
    device = "Tablet";
  } else if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(ua)) {
    device = "Mobile";
  }

  return { browser, browserVersion: majorVersion(browserVersion), os, osVersion, device, isBot };
}

function majorVersion(v: string | null): string | null {
  if (!v) return null;
  return v.split(".")[0] ?? v;
}

function windowsVersion(nt: string): string {
  const map: Record<string, string> = {
    "10.0": "10/11",
    "6.3": "8.1",
    "6.2": "8",
    "6.1": "7",
    "6.0": "Vista",
    "5.1": "XP",
  };
  return map[nt] ?? nt;
}

/** Screen-size buckets matching Plausible's definitions. */
export function screenSize(width?: number): string | null {
  if (!width || width <= 0) return null;
  if (width < 576) return "Mobile";
  if (width < 992) return "Tablet";
  if (width < 1440) return "Laptop";
  return "Desktop";
}

/** Known referrer-host → friendly source name (a small, high-signal subset). */
const SOURCE_MAP: Record<string, string> = {
  "t.co": "Twitter",
  "twitter.com": "Twitter",
  "x.com": "Twitter",
  "www.google.com": "Google",
  "google.com": "Google",
  "www.bing.com": "Bing",
  "bing.com": "Bing",
  "duckduckgo.com": "DuckDuckGo",
  "www.reddit.com": "Reddit",
  "reddit.com": "Reddit",
  "out.reddit.com": "Reddit",
  "www.linkedin.com": "LinkedIn",
  "linkedin.com": "LinkedIn",
  "lnkd.in": "LinkedIn",
  "www.facebook.com": "Facebook",
  "facebook.com": "Facebook",
  "l.facebook.com": "Facebook",
  "m.facebook.com": "Facebook",
  "www.youtube.com": "YouTube",
  "youtube.com": "YouTube",
  "news.ycombinator.com": "Hacker News",
  "github.com": "GitHub",
  "www.instagram.com": "Instagram",
  "instagram.com": "Instagram",
  "l.instagram.com": "Instagram",
};

export interface SourceInfo {
  referrer: string | null;
  referrerSource: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

/**
 * Derive the traffic source. A utm_source query param always wins; otherwise the
 * referrer host is normalised. Same-host referrers (internal navigation) and empty
 * referrers are reported as "Direct".
 */
export function deriveSource(pageUrl: URL, referrer: string | null, selfHost: string): SourceInfo {
  const utmSource = pageUrl.searchParams.get("utm_source");
  const utmMedium = pageUrl.searchParams.get("utm_medium");
  const utmCampaign = pageUrl.searchParams.get("utm_campaign");

  let referrerSource: string | null = null;
  let cleanRef: string | null = null;

  if (referrer) {
    try {
      const refUrl = new URL(referrer);
      cleanRef = refUrl.hostname + (refUrl.pathname !== "/" ? refUrl.pathname : "");
      if (refUrl.hostname && refUrl.hostname !== selfHost) {
        const host = refUrl.hostname.toLowerCase();
        referrerSource = SOURCE_MAP[host] ?? host.replace(/^www\./, "");
      }
    } catch {
      /* malformed referrer — ignore */
    }
  }

  const source = utmSource ?? referrerSource;
  return {
    referrer: cleanRef,
    referrerSource: source,
    utmSource: utmSource ?? null,
    utmMedium: utmMedium ?? null,
    utmCampaign: utmCampaign ?? null,
  };
}
