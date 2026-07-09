import { Hono } from "hono";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";

const socialFollowersRouter = new Hono();

/** Read SCRAPINGBEE_API_KEY from env or .env file at runtime */
function getScrapingBeeKey(): string | undefined {
  // Try process.env first
  if (process.env.SCRAPINGBEE_API_KEY) return process.env.SCRAPINGBEE_API_KEY;
  // Fallback: read from .env file directly
  try {
    const envFile = readFileSync(join(process.cwd(), ".env"), "utf-8");
    const match = envFile.match(/^SCRAPINGBEE_API_KEY=(.+)$/m);
    if (match) return match[1]!.trim();
  } catch {}
  return undefined;
}

const querySchema = z.object({
  handle: z.string().min(1, "handle is required"),
  platform: z.enum(["instagram", "tiktok"], {
    error: "platform must be 'instagram' or 'tiktok'",
  }),
});

/** Parse "277", "12.5K", "1.2M" → integer */
function parseCount(raw: string): number {
  const clean = raw.replace(/,/g, "").trim();
  const lower = clean.toLowerCase();
  if (lower.endsWith("k")) return Math.round(parseFloat(clean) * 1_000);
  if (lower.endsWith("m")) return Math.round(parseFloat(clean) * 1_000_000);
  if (lower.endsWith("b")) return Math.round(parseFloat(clean) * 1_000_000_000);
  return parseInt(clean, 10) || 0;
}

/**
 * Scrape a URL via ScrapingBee and return the raw HTML body.
 * Uses render_js=true so Instagram/TikTok actually populate the page.
 */
async function scrapeHtml(targetUrl: string): Promise<string | null> {
  const apiKey = getScrapingBeeKey();
  if (!apiKey) {
    console.warn("[social-followers] SCRAPINGBEE_API_KEY not set");
    return null;
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    url: targetUrl,
    render_js: "true",
    wait: "3000",
    premium_proxy: "true",
    block_resources: "false",
  });

  console.log(`[social-followers] ScrapingBee request for ${targetUrl}`);
  const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[social-followers] ScrapingBee ${res.status} for ${targetUrl}: ${body.slice(0, 200)}`
    );
    return null;
  }

  return res.text();
}

/** Extract follower count from Instagram HTML using multiple strategies */
function parseInstagramHtml(html: string): number | null {
  // Strategy 1: OG description — "277 Followers, 123 Following, 45 Posts"
  const ogMatch = html.match(
    /<meta\s+property="og:description"\s+content="([^"]+)"/i
  );
  if (ogMatch) {
    const descMatch = ogMatch[1]!.match(/([\d.,]+[KMBkmb]?)\s+Followers/i);
    if (descMatch) return parseCount(descMatch[1]!);
  }

  // Strategy 2: JSON "edge_followed_by":{"count":277}
  const edgeMatch = html.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
  if (edgeMatch) return parseInt(edgeMatch[1]!, 10);

  // Strategy 3: JSON "follower_count":277
  const countMatch = html.match(/"follower_count"\s*:\s*(\d+)/);
  if (countMatch) return parseInt(countMatch[1]!, 10);

  return null;
}

/** Extract follower count from TikTok HTML using multiple strategies */
function parseTikTokHtml(html: string): number | null {
  // Strategy 1: OG description — "12.5K Followers, 456 Following"
  const ogMatch = html.match(
    /<meta\s+property="og:description"\s+content="([^"]+)"/i
  );
  if (ogMatch) {
    const descMatch = ogMatch[1]!.match(/([\d.,]+[KMBkmb]?)\s+Followers/i);
    if (descMatch) return parseCount(descMatch[1]!);
  }

  // Strategy 2: JSON "followerCount":277
  const countMatch = html.match(/"followerCount"\s*:\s*(\d+)/);
  if (countMatch) return parseInt(countMatch[1]!, 10);

  return null;
}

async function fetchInstagramFollowers(handle: string): Promise<number | null> {
  try {
    const html = await scrapeHtml(`https://www.instagram.com/${handle}/`);
    if (!html) return null;
    const count = parseInstagramHtml(html);
    if (count != null) console.log(`[social-followers] IG parsed: ${count}`);
    return count;
  } catch (e) {
    console.warn("[social-followers] Instagram error:", e);
    return null;
  }
}

async function fetchTikTokFollowers(handle: string): Promise<number | null> {
  try {
    const html = await scrapeHtml(`https://www.tiktok.com/@${handle}`);
    if (!html) return null;
    const count = parseTikTokHtml(html);
    if (count != null) console.log(`[social-followers] TikTok parsed: ${count}`);
    return count;
  } catch (e) {
    console.warn("[social-followers] TikTok error:", e);
    return null;
  }
}

socialFollowersRouter.get("/", async (c) => {
  const handle = c.req.query("handle");
  const platform = c.req.query("platform");

  const result = querySchema.safeParse({ handle, platform });
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join("; ");
    return c.json({ error: { message, code: "VALIDATION_ERROR" } }, 400);
  }

  const { handle: h, platform: p } = result.data;
  const cleanHandle = h.replace(/^@/, "");
  console.log(`[social-followers] Fetching @${cleanHandle} on ${p}`);

  const count =
    p === "instagram"
      ? await fetchInstagramFollowers(cleanHandle)
      : await fetchTikTokFollowers(cleanHandle);

  if (count == null) {
    console.warn(`[social-followers] Could not fetch count for @${cleanHandle} on ${p}`);
    return c.json(
      { error: { message: "Could not fetch follower count", code: "FETCH_ERROR" } },
      502
    );
  }

  console.log(`[social-followers] @${cleanHandle} on ${p} → ${count} followers`);
  return c.json({ data: { count, platform: p } });
});

export { socialFollowersRouter };
