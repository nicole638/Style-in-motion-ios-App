import { env } from "./_shared.ts";

// ScrapingBee can hang indefinitely on slow upstream merchants (especially
// premium+render_js for sites like Macy's). Without a timeout, the Hono
// server waits forever and the platform proxy returns 502 to the client.
// 25s gives premium fetches enough time while staying under typical 30s
// proxy timeouts.
const SB_TIMEOUT_MS = 15000;


const SCRAPINGBEE_PREMIUM = [
  'macys.com',
  'hollisterco.com',
  'abercrombie.com',
  'bloomingdales.com',
  'kohls.com',
];

const SCRAPINGBEE_RENDER_JS = [
  'nordstrom.com',
  'dillards.com',
];

export function getScrapingBeeMode(url: string): 'premium' | 'render_js' | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
  for (const d of SCRAPINGBEE_PREMIUM) {
    if (host === d || host.endsWith('.' + d)) return 'premium';
  }
  for (const d of SCRAPINGBEE_RENDER_JS) {
    if (host === d || host.endsWith('.' + d)) return 'render_js';
  }
  return null;
}

export async function fetchViaScrapingBee(url: string): Promise<string | null> {
  const mode = getScrapingBeeMode(url);
  if (!mode) return null;

  const apiKey = env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    console.error('[scrapingbee] SCRAPINGBEE_API_KEY not set');
    return null;
  }

  // ScrapingBee params: block_ads=true (always); premium_proxy=true for geo-restricted sites;
  // render_js=true + wait=0 for SPAs (return immediately after load, skip idle wait).
  const params = new URLSearchParams({
    api_key: apiKey,
    url,
    block_ads: 'true',
    ...(mode === 'premium' ? { premium_proxy: 'true' } : {}),
    ...(mode === 'render_js' ? { render_js: 'true', wait: '0' } : {}),
  });

  console.log(`[scrapingbee] ${mode} fetch for ${url}`);
  try {
    const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
      signal: AbortSignal.timeout(SB_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[scrapingbee] failed ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error('[scrapingbee] network error', err);
    return null;
  }
}

/**
 * Raw ScrapingBee proxy fetch (premium residential proxy, NO render_js) — returns
 * the upstream response body verbatim. Used to fetch JSON endpoints (e.g. a
 * Shopify /products/<handle>.json) through a residential IP when the site's edge
 * (Cloudflare/Akamai) blocks a plain datacenter fetch. render_js is OFF so JSON
 * comes back as JSON rather than wrapped in a rendered HTML page.
 */
export async function fetchRawViaScrapingBee(url: string, timeoutMs = SB_TIMEOUT_MS): Promise<string | null> {
  const apiKey = env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    console.error('[scrapingbee-raw] SCRAPINGBEE_API_KEY not set');
    return null;
  }
  const params = new URLSearchParams({
    api_key: apiKey,
    url,
    premium_proxy: 'true',
    render_js: 'false',
    block_ads: 'true',
  });
  try {
    const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[scrapingbee-raw] ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn('[scrapingbee-raw] network error', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-detection of bot-blocked retailers
// ---------------------------------------------------------------------------

export type BotBlockSignal = {
  isBlocked: boolean;
  reason?:
    | 'http_403'
    | 'http_429'
    | 'challenge_title'
    | 'cloudflare_server'
    | 'akamai_server'
    | 'sparse_body';
  detail?: string;
};

const CHALLENGE_TITLE_PATTERNS = [
  /just a moment/i,
  /attention required/i,
  /access denied/i,
  /pardon our interruption/i,
  /^cloudflare$/i,
];

/**
 * Inspects an HTTP response (status + headers + body) and reports whether
 * the response looks like a bot-block / challenge page. Used to auto-route
 * unknown retailers to ScrapingBee on the retry without hardcoding domains.
 */
export function detectBotBlock(
  status: number,
  headers: Headers,
  body: string,
): BotBlockSignal {
  // Status codes
  if (status === 403) return { isBlocked: true, reason: 'http_403' };
  if (status === 429) return { isBlocked: true, reason: 'http_429' };

  // Server headers (Cloudflare / Akamai bot-challenge edges)
  const server = (headers.get('server') || '').toLowerCase();
  if (server.includes('cloudflare')) {
    return { isBlocked: true, reason: 'cloudflare_server', detail: server };
  }
  if (server.includes('akamai')) {
    return { isBlocked: true, reason: 'akamai_server', detail: server };
  }

  // Title patterns (works only if we got a real body)
  const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1]!.trim() : '';
  if (title && CHALLENGE_TITLE_PATTERNS.some((p) => p.test(title))) {
    return { isBlocked: true, reason: 'challenge_title', detail: title };
  }

  // Sparse body: small + no OG tags + no JSON-LD = almost certainly a
  // bot-block or empty SPA shell rather than a real product page.
  if (body.length < 8000) {
    const hasOg = /property\s*=\s*["']og:/i.test(body);
    const hasJsonLd = /application\/ld\+json/i.test(body);
    if (!hasOg && !hasJsonLd) {
      return {
        isBlocked: true,
        reason: 'sparse_body',
        detail: `${body.length}b, no og or json-ld`,
      };
    }
  }

  return { isBlocked: false };
}

/**
 * Same as fetchViaScrapingBee but does not require the URL to appear in
 * getScrapingBeeMode(). Used as the auto-fallback when detectBotBlock fires
 * on an unknown domain. Always uses premium_proxy + render_js (~30 credits)
 * because we don't know which protection the new site uses.
 */
export async function fetchViaScrapingBeeAuto(url: string): Promise<string | null> {
  const apiKey = env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    console.error('[scrapingbee] SCRAPINGBEE_API_KEY not set');
    return null;
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    url,
    premium_proxy: 'true', // safest default for unknown bot protection
    render_js: 'true', // covers SPA shells too
    block_ads: 'true', // skip ad scripts for speed
    wait: '0', // skip default 2000ms wait — we don't need rendered animations
  });

  console.log(`[scrapingbee-auto] auto-fallback fetch for ${url}`);
  try {
    const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
      signal: AbortSignal.timeout(SB_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[scrapingbee-auto] failed ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error('[scrapingbee-auto] network error', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// In-memory TTL cache of auto-detected bot-blocked domains
// ---------------------------------------------------------------------------

const AUTO_BLOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const autoDetectedBlockedDomains = new Map<string, number>();

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns true if this domain auto-detected as bot-blocked recently and
 * the cache entry has not yet expired. Lets callers skip the wasted
 * direct-fetch attempt and go straight to ScrapingBee.
 */
export function isCachedBlocked(url: string): boolean {
  const host = hostFromUrl(url);
  if (!host) return false;
  const expiry = autoDetectedBlockedDomains.get(host);
  if (expiry === undefined) return false;
  if (expiry <= Date.now()) {
    autoDetectedBlockedDomains.delete(host);
    return false;
  }
  return true;
}

/**
 * Record that a domain auto-detected as bot-blocked. Subsequent fetches
 * within the TTL skip direct fetch and go straight to ScrapingBee.
 */
export function markCachedBlocked(url: string): void {
  const host = hostFromUrl(url);
  if (!host) return;
  autoDetectedBlockedDomains.set(host, Date.now() + AUTO_BLOCK_TTL_MS);
}
