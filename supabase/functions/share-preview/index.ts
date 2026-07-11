// share-preview — synchronous preview for the rich iOS "Share → Styled in Motion"
// extension (Snapshop-style in-sheet editor). Given the creator's device token and
// a shared product URL, returns everything the share sheet needs to render at once:
//
//   POST { token, url }
//   → { data: {
//         product: { name, brand, price, images: string[], primaryImage: string|null, siteName },
//         commission: { merchantName, minPct, maxPct, network, logoUrl } | null,
//         collections: [{ id, title, coverUrl }]     // the creator's Looks
//       } }
//   → { error: { message, code } }
//
// Auth is the App-Group device token (same as share-add-item) — no JWT, so it
// works when the app is closed. The scrape reuses the product-info edge function
// (same tiered scraper the app uses). Commission is looked up by web domain in
// affiliate_merchants (the unified cross-network merchants table): a real range
// when the brand is in one of our networks, null otherwise — the caller shows
// "Not commissionable yet" rather than a fake number.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function errRes(message: string, code: string, status: number) {
  return jsonRes({ error: { message, code } }, status);
}

// Registrable-ish host helpers. affiliate_merchants.domain stores the apex
// (e.g. "aritzia.com"); we match both the full host and the apex, plus the
// alt_domains array. Good enough for the US fashion merchants we carry.
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
function apexOf(host: string): string {
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

interface CommissionMatch {
  merchantName: string | null;
  minPct: number | null;
  maxPct: number | null;
  network: string | null;
  logoUrl: string | null;
}

async function lookupCommission(
  supa: ReturnType<typeof createClient>,
  url: string,
): Promise<CommissionMatch | null> {
  const host = hostOf(url);
  if (!host) return null;
  const apex = apexOf(host);

  // Try exact host / apex / alt_domains membership, active (non-archived) only.
  const { data, error } = await supa
    .from("affiliate_merchants")
    .select("merchant_name, domain, alt_domains, commission_min, commission_max, network, logo_url, status, archived_at")
    .or(
      `domain.eq.${host},domain.eq.${apex},alt_domains.cs.{${host}},alt_domains.cs.{${apex}}`,
    )
    .is("archived_at", null)
    .limit(10);

  if (error || !data || data.length === 0) return null;

  // Prefer an active merchant with the richest commission info.
  const ranked = (data as Array<Record<string, unknown>>)
    .filter((m) => (m.status ?? "active") !== "inactive")
    .sort((a, b) => Number(b.commission_max ?? 0) - Number(a.commission_max ?? 0));
  const best = ranked[0] ?? (data as Array<Record<string, unknown>>)[0];
  if (!best) return null;

  const minPct = best.commission_min == null ? null : Number(best.commission_min);
  const maxPct = best.commission_max == null ? null : Number(best.commission_max);
  // No usable number → treat as "not commissionable yet".
  if (minPct == null && maxPct == null) return null;

  return {
    merchantName: (best.merchant_name as string) ?? null,
    minPct,
    maxPct,
    network: (best.network as string) ?? null,
    logoUrl: (best.logo_url as string) ?? null,
  };
}

interface ProductPreview {
  name: string | null;
  brand: string | null;
  price: string | null;
  images: string[];
  primaryImage: string | null;
  siteName: string | null;
}

async function scrapeProduct(url: string): Promise<ProductPreview> {
  const empty: ProductPreview = {
    name: null, brand: null, price: null, images: [], primaryImage: null, siteName: null,
  };
  try {
    // cache=0 → fast preview: product-info returns raw merchant image URLs and
    // skips the storage image-cache round-trip (durable caching happens at save).
    const endpoint = `${SUPABASE_URL}/functions/v1/product-info?cache=0&url=${encodeURIComponent(url)}`;
    const res = await fetch(endpoint, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return empty;
    const body = await res.json().catch(() => null);
    const d = body?.data;
    if (!d) return empty;
    // De-dupe images while preserving order; primary first.
    const imgs: string[] = [];
    const seen = new Set<string>();
    for (const u of [d.imageUrl, ...(Array.isArray(d.imageUrls) ? d.imageUrls : [])]) {
      if (typeof u === "string" && u && !seen.has(u)) {
        seen.add(u);
        imgs.push(u);
      }
    }
    return {
      name: d.name ?? null,
      brand: d.brand ?? null,
      price: d.price ?? null,
      images: imgs.slice(0, 8),
      primaryImage: imgs[0] ?? null,
      siteName: d.siteName ?? null,
    };
  } catch {
    return empty;
  }
}

// "Product memory": cache the scraped product by URL so a repeat share of the
// same product is instant (skips the slow re-scrape on bot-protected retailers).
// Only the creator-agnostic product blob is cached — commission + collections
// stay live per request.
const PRODUCT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function getProduct(
  supa: ReturnType<typeof createClient>,
  url: string,
): Promise<ProductPreview> {
  // 1) Fresh cache hit → instant.
  try {
    const { data } = await supa
      .from("share_product_cache")
      .select("product, cached_at")
      .eq("url", url)
      .maybeSingle();
    if (data) {
      const row = data as { product: ProductPreview; cached_at: string };
      const age = Date.now() - Date.parse(row.cached_at);
      if (Number.isFinite(age) && age < PRODUCT_CACHE_TTL_MS && row.product) {
        return row.product;
      }
    }
  } catch (_e) {
    // cache read is best-effort — fall through to a live scrape
  }

  // 2) Miss (or stale) → scrape (fast mode), then remember it if usable.
  const product = await scrapeProduct(url);
  const usable = !!(product.name || product.primaryImage || product.images.length);
  if (usable) {
    try {
      await supa
        .from("share_product_cache")
        .upsert({ url, product, cached_at: new Date().toISOString() }, { onConflict: "url" });
    } catch (_e) {
      // best-effort; a failed write just means the next share re-scrapes
    }
  }
  return product;
}

async function loadCollections(
  supa: ReturnType<typeof createClient>,
  creatorId: string,
): Promise<Array<{ id: string; title: string; coverUrl: string | null }>> {
  const { data, error } = await supa
    .from("looks")
    .select("id, title, cover_photo_url, updated_at")
    .eq("creator_id", creatorId)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((l) => ({
    id: l.id as string,
    title: ((l.title as string) ?? "").trim() || "Untitled look",
    coverUrl: (l.cover_photo_url as string) ?? null,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errRes("Method not allowed", "METHOD_NOT_ALLOWED", 405);

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* */ }
  const url = (body.url ?? "").trim();
  const token = (body.token ?? "").trim();
  if (!token) return errRes("Missing token", "MISSING_TOKEN", 400);
  if (!/^https?:\/\//i.test(url)) return errRes("Invalid URL", "INVALID_URL", 400);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Resolve creator from the device token (same as share-add-item).
  const { data: tok, error: tokErr } = await supa
    .from("share_device_tokens")
    .select("creator_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (tokErr) return errRes("Token lookup failed", "TOKEN_LOOKUP_FAILED", 500);
  if (!tok || (tok as Record<string, unknown>).revoked_at) {
    return errRes("Open the app and sign in", "INVALID_TOKEN", 401);
  }
  const creatorId = (tok as Record<string, unknown>).creator_id as string;

  // Product (cache-first) + commission + collections in parallel — fast sheet.
  const [product, commission, collections] = await Promise.all([
    getProduct(supa, url),
    lookupCommission(supa, url),
    loadCollections(supa, creatorId),
  ]);

  return jsonRes({ data: { product, commission, collections } });
});
