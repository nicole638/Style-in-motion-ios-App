// scrape-fortress v2 — parser fix.
//
// ScrapingBee's json_response shape: { body: {...rendered text...},
// cookies: [], headers: {}, ai_response: "<json string>", cost: 80, ... }
// The ai_response is at top level, NOT nested inside body. v1 looked in
// the wrong place and returned empty fields. Fixed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCRAPINGBEE_KEY = Deno.env.get("SCRAPINGBEE_API_KEY") ?? "";

const FORTRESS_DOMAINS = new Set([
  "dickssportinggoods.com",
  "aritzia.com",
  "macys.com",
  "nordstrom.com",
  "bloomingdales.com",
  "ulta.com",
  "sephora.com",
]);

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function isFortressDomain(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (FORTRESS_DOMAINS.has(h)) return true;
  for (const d of FORTRESS_DOMAINS) if (h.endsWith(`.${d}`)) return true;
  return false;
}

function upgradeImageUrl(url: string): string {
  if (!url) return url;
  if (url.includes("scene7.com")) {
    // Scene7: bump wid to 1500, drop hei (auto-scales)
    let upgraded = url.replace(/([?&])wid=\d+/g, "$1wid=1500");
    upgraded = upgraded.replace(/([?&])hei=\d+/g, "$1");
    // If neither wid nor hei was present, append wid=1500
    if (!/[?&]wid=/.test(upgraded)) {
      upgraded += (upgraded.includes("?") ? "&" : "?") + "wid=1500";
    }
    // Clean up trailing/duplicate ampersands
    return upgraded.replace(/&&+/g, "&").replace(/[?&]$/, "");
  }
  return url;
}

/**
 * Parse the AI extraction. ScrapingBee returns the AI response as a
 * JSON-stringified field at the top level of the json_response payload.
 */
function parseAiResponse(sbJson: any): {
  name: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  inStock: boolean | null;
} {
  const empty = { name: null, brand: null, price: null, currency: null, imageUrl: null, imageUrls: [], inStock: null };
  const aiStr = sbJson?.ai_response;
  if (typeof aiStr !== "string") return empty;
  let ai: any;
  try { ai = JSON.parse(aiStr); } catch { return empty; }

  const name = ai.product_name ?? ai.name ?? ai.title ?? null;
  const brand = ai.brand ?? ai.manufacturer ?? null;
  const priceRaw = ai.price_usd ?? ai.price ?? null;
  const price = priceRaw === null || priceRaw === undefined
    ? null
    : Number(String(priceRaw).replace(/[^\d.]/g, ""));

  const imgPrimary = ai.main_product_image_url ?? ai.main_image_url ?? ai.image_url ?? ai.image ?? null;

  let allImgs: string[] = [];
  const allRaw = ai.all_image_urls ?? ai.image_urls ?? ai.images ?? null;
  if (Array.isArray(allRaw)) {
    allImgs = allRaw.filter((x) => typeof x === "string" && x.startsWith("http"));
  } else if (typeof allRaw === "string") {
    allImgs = allRaw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.startsWith("http"));
  }
  if (imgPrimary && !allImgs.includes(imgPrimary)) allImgs.unshift(imgPrimary);

  const upgraded = allImgs.map(upgradeImageUrl);
  const finalImgUrl = upgraded[0] ?? null;

  return {
    name: typeof name === "string" ? name.slice(0, 300) : null,
    brand: typeof brand === "string" ? brand.slice(0, 200) : null,
    price: Number.isFinite(price as number) ? (price as number) : null,
    currency: typeof ai.currency === "string" ? ai.currency : "USD",
    imageUrl: finalImgUrl,
    imageUrls: upgraded.slice(0, 6),
    inStock: typeof ai.in_stock === "boolean" ? ai.in_stock
      : (typeof ai.in_stock === "string" ? /^(true|in[_ ]?stock|yes)$/i.test(ai.in_stock) : null),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  if (!SCRAPINGBEE_KEY) return jsonRes({ error: "no_scrapingbee_key" }, 500);

  let body: { url?: string; item_id?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const url = body.url;
  if (!url) return jsonRes({ error: "missing_url" }, 400);

  let host = "";
  try { host = new URL(url).hostname; } catch { return jsonRes({ error: "bad_url" }, 400); }

  if (!isFortressDomain(host)) {
    return jsonRes({
      ok: false,
      error: "not_a_fortress_domain",
      detail: `${host} doesn't require the premium tier. Route through scrape-product instead.`,
    }, 400);
  }

  const t0 = Date.now();
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_KEY,
    url, render_js: "true", stealth_proxy: "true", country_code: "us",
    device: "mobile", wait: "5000",
    ai_extract_rules: JSON.stringify({
      product_name: "the full product name as displayed on the page",
      brand: "the brand or manufacturer name",
      price_usd: "the current selling price in USD as a number (no currency symbol)",
      currency: "the currency code (USD, GBP, EUR, etc)",
      main_product_image_url: "the highest quality main product image URL",
      all_image_urls: "comma-separated list of all product image URLs visible on the page, in display order, highest quality versions",
      in_stock: "true if the product is available for purchase, false otherwise",
    }),
    json_response: "true",
  });

  let sbRes: Response;
  try {
    sbRes = await fetch(
      `https://app.scrapingbee.com/api/v1/?${params.toString()}`,
      { signal: AbortSignal.timeout(90000) },
    );
  } catch (e) {
    return jsonRes({ ok: false, error: `fetch_failed: ${(e as Error).message}` }, 502);
  }
  if (!sbRes.ok) {
    return jsonRes({ ok: false, error: `scrapingbee_${sbRes.status}`, detail: (await sbRes.text()).slice(0, 400) }, 502);
  }

  let sbJson: any;
  try { sbJson = await sbRes.json(); } catch { return jsonRes({ ok: false, error: "sb_not_json" }, 502); }

  const credits = Number(sbJson?.cost ?? 0);
  const initialStatus = Number(sbJson?.["initial-status-code"] ?? 0);
  const fields = parseAiResponse(sbJson);  // FIXED: pass sbJson directly, not sbJson.body

  if (body.item_id && fields.name) {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const update: Record<string, unknown> = {
      fetch_status: "complete",
      fetch_completed_at: new Date().toISOString(),
      fetch_error: null,
    };
    if (fields.name) update.name = fields.name;
    if (fields.brand) update.brand = fields.brand;
    if (fields.price !== null) update.price = String(fields.price);
    if (fields.imageUrl) update.photo_url = fields.imageUrl;
    if (fields.imageUrl) update.original_photo_url = fields.imageUrl;
    update.candidate_photo_urls = fields.imageUrls;
    await supa.from("creator_items").update(update).eq("id", body.item_id);
  }

  return jsonRes({
    ok: !!fields.name,
    fields,
    http_status: initialStatus,
    latency_ms: Date.now() - t0,
    credits_used: credits,
  });
});
