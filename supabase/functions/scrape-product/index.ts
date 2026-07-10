// scrape-product — async product metadata fetch, fired by pg_net trigger
// on creator_items rows where fetch_status='pending'.
//
// v31 (Bright Data LIVE fallback): the v26 A/B shadow is promoted to a real
//      rescue tier. When USE_BRIGHTDATA=true and the free + ScrapingBee stack
//      fails to produce a name AND image, scrape-product now calls Bright Data
//      Web Unlocker and USES the result (same HTML out → parseHtml() reused).
//      Fires only on the hard sites that would otherwise fail, so cost is
//      bounded to real failures. The fire-and-forget shadow is removed (the
//      BD attempt is now logged as a normal source='brightdata' attempt).
//      Reversible: flip USE_BRIGHTDATA off → pre-v31 behavior.
//
// v22: matchMeta/matchMetaAll handle apostrophes inside double-quoted
//      content attrs (og:title "Women's …" was truncating to "Women").
// v21: tiktok.com added to ANTI_BOT_DOMAINS — TikTok Shop blocks direct
//      and basic-proxy fetches; skip straight to ScrapingBee stealth.
// v20 (bot-block guard): detect CAPTCHA/security interstitials (observed
// 2026-06-06: TikTok Shop "Security Check" slider CAPTCHA scraped as the
// product — title became the item name, the puzzle image became the photo,
// and the cutout pipeline produced a literal puzzle-piece PNG). Those
// scrapes now fail cleanly without persisting any fields.
//
// v13 (auto-cutout chain): after a successful scrape writes photo_url, we
// fire-and-forget invoke cutout-item-photo so the new item is collage-
// ready without the creator having to interact with the picker. Picker
// stays available for overrides. EdgeRuntime.waitUntil keeps the lambda
// alive until the cutout call finishes (or 30s timeout) without blocking
// scrape-product's response.
//
// v12 (Shopify product-JSON fast path): Tier 0.5 fetches /products/<handle>.json
// for the full image gallery (6 candidates for any Shopify store).
// v11: hasEnoughForEarlyExit requires imageUrls.length >= 2 + aritzia.com
//      added to ANTI_BOT_DOMAINS.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCRAPINGBEE_KEY = Deno.env.get("SCRAPINGBEE_API_KEY") ?? "";

// ── Bright Data Web Unlocker (flag-gated LIVE fallback as of v31) ──────
// When USE_BRIGHTDATA=true we call Web Unlocker as the last-resort tier and
// USE the unlocked HTML (parseHtml() reused). Flip the flag off to disable.
const BRIGHTDATA_API_KEY = Deno.env.get("BRIGHTDATA_API_KEY") ?? "";
const BRIGHTDATA_UNLOCKER_ZONE = Deno.env.get("BRIGHTDATA_UNLOCKER_ZONE") ?? "cli_unlocker";
const USE_BRIGHTDATA = (Deno.env.get("USE_BRIGHTDATA") ?? "").toLowerCase() === "true";

const MAX_CANDIDATES = 6;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ANTI_BOT_DOMAINS = new Set([
  "tiktok.com",
  "nike.com",
  "zara.com",
  "skims.com",
  "reformation.com",
  "us.princesspolly.com",
  "princesspolly.com",
  "aloyoga.com",
  "macys.com",
  "asos.com",
  "aritzia.com",
]);

const AMAZON_SHORTLINK_HOSTS = new Set([
  "a.co",
  "amzn.to",
  "amzn.eu",
  "amzn.asia",
]);

type ScrapedFields = {
  name: string | null;
  brand: string | null;
  price: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  originalImageUrl: string | null;
  description: string | null;
  canonicalUrl: string | null;
};

const EMPTY_FIELDS: ScrapedFields = {
  name: null,
  brand: null,
  price: null,
  imageUrl: null,
  imageUrls: [],
  originalImageUrl: null,
  description: null,
  canonicalUrl: null,
};

const BLOCK_PAGE_TITLE_RES: RegExp[] = [
  /^\s*security check/i,
  /^\s*access denied/i,
  /^\s*access to this page has been denied/i,
  /^\s*just a moment/i,
  /^\s*attention required/i,
  /^\s*pardon our interruption/i,
  /^\s*robot or human/i,
  /are you a (?:robot|human)/i,
  /verify(?:ing)? you are (?:a )?human/i,
  /\bcaptcha\b/i,
  /^\s*request blocked/i,
  /^\s*403 forbidden/i,
];

function looksLikeBlockPage(fields: ScrapedFields): boolean {
  const title = fields.name ?? "";
  if (BLOCK_PAGE_TITLE_RES.some((re) => re.test(title))) return true;
  const img = fields.imageUrl ?? "";
  if (/captcha|securimage|botdetect/i.test(img)) return true;
  return false;
}

function hasEnoughForEarlyExit(f: ScrapedFields): boolean {
  return (
    countFields(f) >= 3 &&
    !!f.imageUrl &&
    f.imageUrls.length >= 2
  );
}

function triggerCutout(itemId: string): void {
  const promise = fetch(
    `${SUPABASE_URL}/functions/v1/cutout-item-photo`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ item_id: itemId }),
      signal: AbortSignal.timeout(60000),
    },
  )
    .then((r) => {
      if (!r.ok) {
        console.warn("[scrape-product] cutout_invoke_non_2xx", {
          itemId,
          status: r.status,
        });
      }
    })
    .catch((e) => {
      console.warn("[scrape-product] cutout_invoke_failed", {
        itemId,
        err: (e as Error).message,
      });
    });

  // @ts-ignore EdgeRuntime is a Deno-on-Supabase global, not in stdlib types
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(promise);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  let body: { item_id?: string; url?: string };
  try { body = await req.json(); } catch { return jsonRes({ error: "bad_json" }, 400); }

  const itemId = body.item_id;
  const url = body.url;
  if (!itemId) return jsonRes({ error: "item_id_required" }, 400);
  if (!url) return jsonRes({ error: "url_required" }, 400);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  await supa.from("creator_items").update({ fetch_started_at: new Date().toISOString() }).eq("id", itemId);

  const startedAt = Date.now();
  let parserPath = "init";

  try {
    const result = await scrapePipeline(url, (path) => { parserPath = path; });

    // v31: Bright Data is now a LIVE fallback tier inside scrapePipeline
    // (no more fire-and-forget shadow). Its attempt is logged via logAttempts.

    if (looksLikeBlockPage(result.fields)) {
      const blockTitle = (result.fields.name ?? "unknown").slice(0, 100);
      await supa.from("creator_items").update({
        fetch_status: "failed",
        fetch_completed_at: new Date().toISOString(),
        fetch_error:
          `Merchant served a bot-block page ("${blockTitle}") — no product data saved [${parserPath}]`,
      }).eq("id", itemId);
      await logAttempts(supa, itemId, url, result, startedAt, parserPath).catch((e) =>
        console.error("[scrape-product] log_failed", { err: (e as Error).message }));
      return jsonRes({
        ok: false,
        status: "failed",
        error: "bot_block_page",
        title: blockTitle,
        attempts: result.attempts.length,
        parser_path: parserPath,
      });
    }

    let cachedImageUrl: string | null = null;
    if (result.fields.imageUrl) {
      cachedImageUrl = await cacheImage(supa, itemId, result.fields.imageUrl).catch((e) => {
        console.error("[scrape-product] image_cache_failed", { itemId, err: (e as Error).message });
        return null;
      });
    }

    const finalImage = cachedImageUrl ?? result.fields.imageUrl;
    const allEmpty = !result.fields.name && !finalImage && !result.fields.price;
    const partial = !allEmpty && (!result.fields.name || !finalImage);
    const status = allEmpty ? "failed" : partial ? "partial" : "complete";
    const error = allEmpty ? `No usable fields after ${result.attempts.length} attempt(s) [${parserPath}]` : null;

    const update: Record<string, unknown> = {
      fetch_status: status,
      fetch_completed_at: new Date().toISOString(),
      fetch_error: error,
    };
    if (result.fields.name) update.name = result.fields.name;
    if (result.fields.brand) update.brand = result.fields.brand;
    if (result.fields.price) update.price = result.fields.price;
    if (finalImage) update.photo_url = finalImage;
    if (result.fields.originalImageUrl) update.original_photo_url = result.fields.originalImageUrl;
    update.candidate_photo_urls = result.fields.imageUrls;

    const { error: dbErr } = await supa.from("creator_items").update(update).eq("id", itemId);
    if (dbErr) {
      console.error("[scrape-product] db_update_failed", { itemId, err: dbErr.message });
      return jsonRes({ error: "db_update_failed", detail: dbErr.message }, 500);
    }

    if (finalImage) {
      triggerCutout(itemId);
    }

    await logAttempts(supa, itemId, url, result, startedAt, parserPath).catch((e) =>
      console.error("[scrape-product] log_failed", { err: (e as Error).message }));

    return jsonRes({ ok: true, status, fields: { ...result.fields, imageUrl: finalImage }, attempts: result.attempts.length, parser_path: parserPath });
  } catch (e) {
    const err = (e as Error).message ?? String(e);
    console.error("[scrape-product] hard_failure", { itemId, err });
    await supa.from("creator_items").update({
      fetch_status: "failed",
      fetch_completed_at: new Date().toISOString(),
      fetch_error: err.slice(0, 500),
    }).eq("id", itemId);
    return jsonRes({ ok: false, error: err }, 500);
  }
});

type AttemptSource = "direct" | "microlink" | "scrapingbee_t1" | "scrapingbee_t3" | "shopify_json" | "brightdata";

type Attempt = {
  source: AttemptSource;
  status: number;
  ok: boolean;
  latency_ms: number;
  fields_count: number;
  error?: string;
};

type PipelineResult = {
  fields: ScrapedFields;
  attempts: Attempt[];
  finalUrl: string;
};

async function scrapePipeline(inputUrl: string, onPath: (path: string) => void): Promise<PipelineResult> {
  const attempts: Attempt[] = [];
  let resolved = inputUrl;
  let parsedHost = "";

  try {
    const u = new URL(inputUrl);
    parsedHost = u.hostname.toLowerCase();
    if (AMAZON_SHORTLINK_HOSTS.has(parsedHost)) {
      const expanded = await resolveShortlink(inputUrl);
      if (expanded) {
        resolved = expanded;
        parsedHost = new URL(expanded).hostname.toLowerCase();
        onPath("amazon_shortlink_resolved");
      }
    }
  } catch { /* bad URL */ }

  const isAntiBot = isAntiBotDomain(parsedHost);
  let best: ScrapedFields = { ...EMPTY_FIELDS, imageUrls: [] };

  if (looksLikeShopifyProductUrl(resolved)) {
    const t0 = Date.now();
    try {
      const shopify = await shopifyProductJson(resolved);
      const fieldsCount = shopify ? countFields(shopify) : 0;
      attempts.push({
        source: "shopify_json",
        status: shopify ? 200 : 404,
        ok: !!shopify && fieldsCount >= 2,
        latency_ms: Date.now() - t0,
        fields_count: fieldsCount,
      });
      if (shopify) {
        best = mergeFields(best, shopify);
        if (hasEnoughForEarlyExit(best)) {
          onPath("shopify_json_ok");
          return { fields: best, attempts, finalUrl: resolved };
        }
      }
    } catch (e) {
      attempts.push({ source: "shopify_json", status: 0, ok: false, latency_ms: Date.now() - t0, fields_count: 0, error: (e as Error).message });
    }
  }

  if (!isAntiBot) {
    const t0 = Date.now();
    try {
      const res = await directFetch(resolved);
      const html = await res.text();
      const fields = parseHtml(html, resolved);
      const fieldsCount = countFields(fields);
      attempts.push({ source: "direct", status: res.status, ok: res.ok && fieldsCount >= 2, latency_ms: Date.now() - t0, fields_count: fieldsCount });
      if (res.ok) {
        best = mergeFields(best, fields);
        if (hasEnoughForEarlyExit(best)) {
          onPath("direct_ok");
          return { fields: best, attempts, finalUrl: resolved };
        }
      }
    } catch (e) {
      attempts.push({ source: "direct", status: 0, ok: false, latency_ms: Date.now() - t0, fields_count: 0, error: (e as Error).message });
    }
  } else {
    onPath("antibot_skip_direct");
  }

  if (!isAntiBot) {
    const t0 = Date.now();
    try {
      const ml = await microlinkFetch(resolved);
      const fieldsCount = ml ? countFields(ml) : 0;
      attempts.push({ source: "microlink", status: ml ? 200 : 0, ok: !!ml && fieldsCount >= 2, latency_ms: Date.now() - t0, fields_count: fieldsCount });
      if (ml) {
        best = mergeFields(best, ml);
        if (hasEnoughForEarlyExit(best)) {
          onPath("microlink_ok");
          return { fields: best, attempts, finalUrl: resolved };
        }
      }
    } catch (e) {
      attempts.push({ source: "microlink", status: 0, ok: false, latency_ms: Date.now() - t0, fields_count: 0, error: (e as Error).message });
    }
  }

  if (SCRAPINGBEE_KEY) {
    if (!isAntiBot) {
      const t0 = Date.now();
      try {
        const res = await scrapingbeeFetch(resolved, { render_js: true, proxy_tier: "basic" });
        const html = await res.text();
        const fields = parseHtml(html, resolved);
        const fieldsCount = countFields(fields);
        attempts.push({ source: "scrapingbee_t1", status: res.status, ok: res.ok && fieldsCount >= 2, latency_ms: Date.now() - t0, fields_count: fieldsCount });
        if (res.ok) {
          best = mergeFields(best, fields);
          if (hasEnoughForEarlyExit(best)) {
            onPath("scrapingbee_t1_ok");
            return { fields: best, attempts, finalUrl: resolved };
          }
        }
      } catch (e) {
        attempts.push({ source: "scrapingbee_t1", status: 0, ok: false, latency_ms: Date.now() - t0, fields_count: 0, error: (e as Error).message });
      }
    }

    const lastT1 = attempts[attempts.length - 1];
    const escalate = isAntiBot ||
      (lastT1?.source === "scrapingbee_t1" &&
        (lastT1.status === 403 || lastT1.status === 410 ||
          lastT1.status === 429 || lastT1.status >= 500 ||
          lastT1.fields_count < 2));

    if (escalate) {
      const t0b = Date.now();
      try {
        const res = await scrapingbeeFetch(resolved, { render_js: true, proxy_tier: "stealth" });
        const html = await res.text();
        const fields = parseHtml(html, resolved);
        const fieldsCount = countFields(fields);
        attempts.push({ source: "scrapingbee_t3", status: res.status, ok: res.ok && fieldsCount >= 2, latency_ms: Date.now() - t0b, fields_count: fieldsCount });
        if (res.ok) {
          best = mergeFields(best, fields);
          onPath("scrapingbee_t3_ok");
        }
      } catch (e) {
        attempts.push({ source: "scrapingbee_t3", status: 0, ok: false, latency_ms: Date.now() - t0b, fields_count: 0, error: (e as Error).message });
      }
    }
  }

  // ── Bright Data Web Unlocker — LIVE last-resort fallback (v31, flag-gated) ──
  // Fires only when the free + ScrapingBee stack failed to produce a name AND
  // image, so the cost is bounded to the hard sites that would otherwise fail.
  // Same HTML out → parseHtml() reused. Reversible via USE_BRIGHTDATA.
  if (USE_BRIGHTDATA && BRIGHTDATA_API_KEY && (!best.name || !best.imageUrl)) {
    const t0 = Date.now();
    try {
      const { status, html } = await brightDataUnlockerFetch(resolved);
      const fields = parseHtml(html, resolved);
      const fieldsCount = countFields(fields);
      const ok = status >= 200 && status < 300 && fieldsCount >= 2 && !looksLikeBlockPage(fields);
      attempts.push({ source: "brightdata", status, ok, latency_ms: Date.now() - t0, fields_count: fieldsCount });
      if (ok) {
        best = mergeFields(best, fields);
        onPath("brightdata_ok");
      }
    } catch (e) {
      attempts.push({ source: "brightdata", status: 0, ok: false, latency_ms: Date.now() - t0, fields_count: 0, error: (e as Error).message });
    }
  }

  if (countFields(best) === 0) {
    onPath("all_attempts_failed");
  } else {
    const winner = attempts.find((a) => a.ok);
    if (winner) onPath(winner.source);
  }

  return { fields: best, attempts, finalUrl: resolved };
}

function looksLikeShopifyProductUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return /\/products\/[^\/]+(?:\.[a-z]+)?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function shopifyProductJson(productUrl: string): Promise<ScrapedFields | null> {
  let jsonUrl: string;
  try {
    const u = new URL(productUrl);
    const path = u.pathname.replace(/\.[a-z]+$/i, "");
    jsonUrl = `${u.protocol}//${u.host}${path}.json`;
  } catch {
    return null;
  }

  let res: Response;
  try {
    res = await fetch(jsonUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let json: any;
  try { json = await res.json(); } catch { return null; }
  const product = json?.product;
  if (!product || typeof product !== "object") return null;

  const title: string | null =
    typeof product.title === "string" ? product.title.slice(0, 300) : null;
  const brand: string | null =
    typeof product.vendor === "string" ? product.vendor.slice(0, 100) : null;

  let price: string | null = null;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  for (const v of variants) {
    const p = v?.price;
    if (typeof p === "string" && p.length > 0) {
      const n = Number(p);
      if (!Number.isNaN(n) && (price === null || n < Number(price))) {
        price = p;
      }
    }
  }

  const description: string | null =
    typeof product.body_html === "string"
      ? product.body_html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1024)
      : null;

  const imageObjs: Array<{ src?: string; position?: number }> = Array.isArray(product.images)
    ? product.images
    : [];
  const sortedImages = [...imageObjs].sort((a, b) => {
    const pa = typeof a.position === "number" ? a.position : 999;
    const pb = typeof b.position === "number" ? b.position : 999;
    return pa - pb;
  });
  const imageUrls = dedupeImages(
    sortedImages
      .map((i) => i.src)
      .filter((s): s is string => typeof s === "string" && s.length > 0),
  ).slice(0, MAX_CANDIDATES);

  if (imageUrls.length === 0 && !title) return null;

  return {
    name: title,
    brand,
    price,
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    originalImageUrl: imageUrls[0] ?? null,
    description,
    canonicalUrl: productUrl,
  };
}

async function directFetch(url: string, timeoutMs = 10000): Promise<Response> {
  return await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });
}

type ProxyTier = "basic" | "premium" | "stealth";

async function scrapingbeeFetch(targetUrl: string, opts: { render_js: boolean; proxy_tier: ProxyTier }): Promise<Response> {
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_KEY,
    url: targetUrl,
    render_js: String(opts.render_js),
    block_resources: "false",
    wait: "2500",
  });

  if (opts.proxy_tier === "premium") {
    params.set("premium_proxy", "true");
    params.set("country_code", "us");
  } else if (opts.proxy_tier === "stealth") {
    params.set("stealth_proxy", "true");
    params.set("country_code", "us");
  }

  const sbTimeout = opts.proxy_tier === "stealth" ? 90000 : 30000;
  return await fetch(
    `https://app.scrapingbee.com/api/v1/?${params.toString()}`,
    { signal: AbortSignal.timeout(sbTimeout) },
  );
}

// ── Bright Data Web Unlocker fetch — returns unlocked page as raw HTML so
// the existing parseHtml() pipeline is reused verbatim. Used by the v31 live
// fallback tier. 100s timeout: real unlock latency reaches ~38s on the
// hardest anti-bot sites (Levi's, Nordstrom).
async function brightDataUnlockerFetch(targetUrl: string): Promise<{ status: number; html: string }> {
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${BRIGHTDATA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      zone: BRIGHTDATA_UNLOCKER_ZONE,
      url: targetUrl,
      format: "raw",
    }),
    signal: AbortSignal.timeout(100000),
  });
  const html = await res.text();
  return { status: res.status, html };
}

async function microlinkFetch(targetUrl: string): Promise<ScrapedFields | null> {
  const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(apiUrl, {
    signal: AbortSignal.timeout(8000),
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json || json.status !== "success" || !json.data) return null;
  const d = json.data as { title?: string; description?: string; url?: string; image?: { url?: string }; publisher?: string };
  const image = d.image?.url ?? null;
  return {
    name: d.title?.slice(0, 300) ?? null,
    brand: d.publisher?.slice(0, 100) ?? null,
    price: null,
    imageUrl: image,
    imageUrls: image ? [image] : [],
    originalImageUrl: image,
    description: d.description?.slice(0, 1024) ?? null,
    canonicalUrl: d.url ?? targetUrl,
  };
}

async function resolveShortlink(shortUrl: string): Promise<string | null> {
  try {
    const res = await fetch(shortUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": BROWSER_UA, "Accept": "text/html" },
    });
    if (!res.ok) return null;
    return res.url;
  } catch { return null; }
}

function parseHtml(html: string, sourceUrl: string): ScrapedFields {
  const trimmed = html.slice(0, 256 * 1024);
  const og = parseOgTags(trimmed);
  const ld = parseJsonLd(trimmed);
  const meta = parseMicrodata(trimmed);
  const tw = parseTwitterTags(trimmed);
  const linkImage = parseLinkImageSrc(trimmed);
  const title = parseTitle(trimmed);
  const canonical = parseCanonical(trimmed) ?? parseOgUrl(trimmed) ?? sourceUrl;

  const name = pickFirst(ld.name, og.title, meta.name, title);
  const brand = pickFirst(ld.brand, og.siteName, meta.brand);
  const price = normalizePrice(pickFirst(ld.price, og.price, meta.price));

  const rawImages: string[] = [
    ...ld.images,
    ...og.images,
    ...tw.images,
    ...(linkImage ? [linkImage] : []),
    ...(meta.image ? [meta.image] : []),
  ];
  const imageUrls = dedupeImages(
    rawImages
      .map((u) => absolutize(u, sourceUrl))
      .filter((u): u is string => !!u),
  ).slice(0, MAX_CANDIDATES);

  const imageUrl = imageUrls[0] ?? null;
  const description = pickFirst(ld.description, og.description, meta.description);
  return {
    name, brand, price, imageUrl, imageUrls,
    originalImageUrl: imageUrl,
    description,
    canonicalUrl: absolutize(canonical, sourceUrl),
  };
}

function parseOgTags(html: string) {
  return {
    title: matchMeta(html, /property=["']og:title["']/i),
    images: matchMetaAll(html, /property=["']og:image(?::(?:secure_url|url))?["']/i),
    description: matchMeta(html, /property=["']og:description["']/i),
    siteName: matchMeta(html, /property=["']og:site_name["']/i),
    price: matchMeta(html, /property=["']og:price:amount["']/i) ?? matchMeta(html, /property=["']product:price:amount["']/i),
  };
}

function parseTwitterTags(html: string) {
  return { images: matchMetaAll(html, /name=["']twitter:image(?::src)?["']/i) };
}

function parseLinkImageSrc(html: string): string | null {
  const m = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function parseOgUrl(html: string): string | null {
  return matchMeta(html, /property=["']og:url["']/i);
}

function parseMicrodata(html: string) {
  return {
    name: matchMeta(html, /itemprop=["']name["']/i),
    brand: matchMeta(html, /itemprop=["']brand["']/i),
    image: matchMeta(html, /itemprop=["']image["']/i),
    price: matchMeta(html, /itemprop=["']price["']/i),
    description: matchMeta(html, /itemprop=["']description["']/i),
  };
}

function parseTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()).slice(0, 200) : null;
}

function parseCanonical(html: string): string | null {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function matchMeta(html: string, attrRe: RegExp): string | null {
  const re1 = new RegExp(`<meta[^>]*${attrRe.source}[^>]*content=(["'])([^>]*?)\\1`, "i");
  const re2 = new RegExp(`<meta[^>]*content=(["'])([^>]*?)\\1[^>]*${attrRe.source}`, "i");
  const m = html.match(re1) ?? html.match(re2);
  if (!m) return null;
  const v = decodeHtmlEntities(m[2].trim());
  return v.length > 0 ? v.slice(0, 1024) : null;
}

function matchMetaAll(html: string, attrRe: RegExp): string[] {
  const out: string[] = [];
  const re1 = new RegExp(`<meta[^>]*${attrRe.source}[^>]*content=(["'])([^>]*?)\\1`, "gi");
  const re2 = new RegExp(`<meta[^>]*content=(["'])([^>]*?)\\1[^>]*${attrRe.source}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re1.exec(html)) !== null) {
    const v = decodeHtmlEntities(m[2].trim());
    if (v) out.push(v.slice(0, 1024));
  }
  while ((m = re2.exec(html)) !== null) {
    const v = decodeHtmlEntities(m[2].trim());
    if (v) out.push(v.slice(0, 1024));
  }
  return out;
}

function parseJsonLd(html: string) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates: any[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) candidates.push(...parsed);
      else if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed["@graph"])) candidates.push(...parsed["@graph"]);
        else candidates.push(parsed);
      }
    } catch { /* skip */ }
  }
  const product = candidates.find((c) => isProductLd(c)) ?? candidates[0] ?? null;
  if (!product) return { name: null, brand: null, images: [], price: null, description: null };
  return {
    name: typeof product.name === "string" ? product.name.slice(0, 300) : null,
    brand: extractBrand(product.brand),
    images: extractImageList(product.image),
    price: extractPrice(product.offers),
    description: typeof product.description === "string" ? product.description.slice(0, 1024) : null,
  };
}

function isProductLd(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const t = (c as any)["@type"];
  if (!t) return false;
  if (Array.isArray(t)) return t.some((x) => String(x).toLowerCase() === "product");
  return String(t).toLowerCase() === "product";
}

function extractBrand(b: unknown): string | null {
  if (!b) return null;
  if (typeof b === "string") return b.slice(0, 100);
  if (typeof b === "object") {
    const name = (b as any).name;
    if (typeof name === "string") return name.slice(0, 100);
  }
  return null;
}

function extractImageList(img: unknown): string[] {
  if (!img) return [];
  if (typeof img === "string") return [img];
  if (Array.isArray(img)) {
    const out: string[] = [];
    for (const x of img) out.push(...extractImageList(x));
    return out;
  }
  if (typeof img === "object") {
    const o = img as any;
    const url = o.url ?? o.contentUrl ?? o["@id"];
    if (typeof url === "string") return [url];
  }
  return [];
}

function extractPrice(offers: unknown): string | null {
  if (!offers) return null;
  if (Array.isArray(offers)) return extractPrice(offers[0]);
  if (typeof offers === "object") {
    const o = offers as any;
    const v = o.price ?? o.priceSpecification?.price ?? o.lowPrice ?? null;
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function dedupeImages(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = normalizeImageKey(u);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

function normalizeImageKey(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return rawUrl.trim() || null;
  }
}

async function cacheImage(supa: ReturnType<typeof createClient>, itemId: string, imageUrl: string): Promise<string | null> {
  if (imageUrl.includes(".supabase.co/storage/")) return imageUrl;
  const res = await fetch(imageUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!res.ok) throw new Error(`image_fetch_${res.status}`);
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 2048) throw new Error(`image_too_small_${bytes.byteLength}`);
  const key = `${itemId}/scrape-${Date.now()}.${ext}`;
  const { error } = await supa.storage.from("item-photos").upload(key, bytes, { contentType: ct, upsert: true });
  if (error) throw new Error(`storage_upload: ${error.message}`);
  return `${SUPABASE_URL}/storage/v1/object/public/item-photos/${key}`;
}

async function logAttempts(supa: ReturnType<typeof createClient>, itemId: string, url: string, result: PipelineResult, startedAt: number, parserPath: string): Promise<void> {
  const { data: row } = await supa.from("creator_items").select("creator_id").eq("id", itemId).maybeSingle();
  const creatorId = row?.creator_id ?? null;
  let domain = "";
  try { domain = new URL(url).hostname.toLowerCase(); } catch { /* ignore */ }
  const fieldFlags = {
    name: !!result.fields.name, brand: !!result.fields.brand, price: !!result.fields.price,
    image: !!result.fields.imageUrl, description: !!result.fields.description,
    image_candidates: result.fields.imageUrls.length,
  };
  const rows = result.attempts.map((a, i) => ({
    creator_id: creatorId, url, domain, source: a.source, source_order: i + 1,
    http_status: a.status, latency_ms: a.latency_ms, ok: a.ok,
    fields_count: a.fields_count, field_flags: fieldFlags, parser_path: parserPath,
    is_final: false, error_message: a.error ?? null,
  }));
  rows.push({
    creator_id: creatorId, url, domain, source: "summary",
    source_order: result.attempts.length + 1,
    http_status: null as any,
    latency_ms: Date.now() - startedAt,
    ok: countFields(result.fields) > 0,
    fields_count: countFields(result.fields),
    field_flags: fieldFlags, parser_path: parserPath,
    is_final: true, error_message: null,
  });
  if (rows.length > 0) await supa.from("metadata_fetch_logs").insert(rows);
}

function isAntiBotDomain(host: string): boolean {
  if (!host) return false;
  const stripped = host.replace(/^www\./, "");
  return ANTI_BOT_DOMAINS.has(stripped) || [...ANTI_BOT_DOMAINS].some((d) => stripped.endsWith(`.${d}`));
}

function pickFirst<T>(...vals: (T | null | undefined)[]): T | null {
  for (const v of vals) if (v !== null && v !== undefined && v !== "") return v;
  return null;
}

function countFields(f: ScrapedFields): number {
  let n = 0;
  if (f.name) n++; if (f.brand) n++; if (f.price) n++;
  if (f.imageUrl) n++; if (f.description) n++;
  return n;
}

function mergeFields(a: ScrapedFields, b: ScrapedFields): ScrapedFields {
  const merged = dedupeImages([...a.imageUrls, ...b.imageUrls]).slice(0, MAX_CANDIDATES);
  return {
    name: a.name ?? b.name,
    brand: a.brand ?? b.brand,
    price: a.price ?? b.price,
    imageUrl: a.imageUrl ?? b.imageUrl,
    imageUrls: merged,
    originalImageUrl: a.originalImageUrl ?? b.originalImageUrl,
    description: a.description ?? b.description,
    canonicalUrl: a.canonicalUrl ?? b.canonicalUrl,
  };
}

function absolutize(href: string | null, base: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try { return new URL(trimmed, base).toString(); } catch { return null; }
}

function normalizePrice(p: string | null): string | null {
  if (!p) return null;
  const cleaned = p.replace(/[^\d.,$€£¥₹\s]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 32) : null;
}

function decodeHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
