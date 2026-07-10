// campaigns — Supabase Edge Function port of the Hono backend's
// /api/campaigns route (Vibecode migration, 2026-07-09). One endpoint:
// GET …/campaigns/amazon-active — active Amazon Creator Connections
// campaigns with a featured product join. Logic verbatim; framework surface
// converted (Hono → Deno.serve).
//
// verify_jwt=false — matches the legacy backend's exposure (public GET of
// promotional campaign data the app renders on the Brands surfaces).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const AMAZON_PLATFORM_ASSOCIATES_TAG =
  Deno.env.get("AMAZON_PLATFORM_ASSOCIATES_TAG") ??
  Deno.env.get("AMAZON_PA_API_PARTNER_TAG") ??
  "styledinmotio-20";

let _admin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  _admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return _admin;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export interface AmazonFeaturedProduct {
  asin: string;
  title: string | null;
  image_url: string | null;
}

export interface ActiveAmazonCampaign {
  id: string;
  brand_name: string;
  brand_logo_url: string | null;
  asins: string[];
  asin_links: Record<string, string>;
  start_date: string;
  end_date: string | null;
  commission_rate_pct: number;
  campaign_type: "affiliate_plus" | "sponsored_products";
  campaign_url: string | null;
  kw: string | null;
  // Pre-resolved URL the mobile client should open. Prefers campaign_url
  // (when present, it already includes Amazon CC's per-campaign tracking),
  // otherwise falls back to a built Special Link with the platform tag.
  shop_url: string | null;
  // Featured product (primary ASIN, joined from amazon_product_cache).
  featured: AmazonFeaturedProduct | null;
}

function buildAmazonSpecialLink(asin: string, tag: string, kw?: string | null): string {
  const u = new URL(`https://www.amazon.com/dp/${asin}`);
  u.searchParams.set("tag", tag);
  if (kw) u.searchParams.set("kw", kw);
  return u.toString();
}

function resolveShopUrl(row: any): string | null {
  if (row.campaign_url && typeof row.campaign_url === "string") return row.campaign_url;
  const firstAsin = Array.isArray(row.asins) ? row.asins[0] : null;
  if (firstAsin && AMAZON_PLATFORM_ASSOCIATES_TAG) {
    return buildAmazonSpecialLink(firstAsin, AMAZON_PLATFORM_ASSOCIATES_TAG, row.kw);
  }
  if (firstAsin) return `https://www.amazon.com/dp/${firstAsin}`;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const pathname = new URL(req.url).pathname;
  const isAmazonActive =
    (req.method === "GET" || req.method === "HEAD") && pathname.endsWith("/amazon-active");
  if (!isAmazonActive) {
    return json({ error: { message: "Not found", code: "NOT_FOUND" } }, 404);
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json({ error: { message: "Database unavailable", code: "DB_UNAVAILABLE" } }, 503);
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("campaigns")
    .select("id, brand_name, brand_logo_url, asins, asin_links, start_date, end_date, commission_rate_pct, campaign_type, campaign_url, kw")
    .eq("source", "amazon_cc")
    .is("archived_at", null)
    .lte("start_date", today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order("commission_rate_pct", { ascending: false });

  if (error) {
    console.error("[campaigns/amazon-active] query failed", error);
    return json({ error: { message: "Query failed", code: "QUERY_FAILED" } }, 500);
  }

  const rows = (data ?? []) as any[];

  // Collect primary ASINs (first entry per campaign) and look them up in
  // amazon_product_cache so the client can render product photo + title
  // without a second round trip.
  const primaryAsins = Array.from(
    new Set(
      rows
        .map((r) => (Array.isArray(r.asins) ? r.asins[0] : null))
        .filter((a): a is string => typeof a === "string" && a.length > 0),
    ),
  );

  const cacheByAsin = new Map<string, AmazonFeaturedProduct>();
  if (primaryAsins.length > 0) {
    const { data: cacheRows, error: cacheError } = await supabase
      .from("amazon_product_cache")
      .select("asin, title, image_url, fetch_status")
      .in("asin", primaryAsins);
    if (cacheError) {
      console.warn("[campaigns/amazon-active] cache lookup failed", cacheError.message);
    } else {
      for (const row of (cacheRows ?? []) as any[]) {
        if (row.fetch_status !== "complete") continue;
        cacheByAsin.set(row.asin, {
          asin: row.asin,
          title: row.title ?? null,
          image_url: row.image_url ?? null,
        });
      }
    }
  }

  const campaigns: ActiveAmazonCampaign[] = rows.map((r) => {
    const asins: string[] = Array.isArray(r.asins) ? r.asins : [];
    const primary = asins[0] ?? null;
    const asinLinksRaw = r.asin_links;
    const asinLinks: Record<string, string> =
      asinLinksRaw && typeof asinLinksRaw === "object" && !Array.isArray(asinLinksRaw)
        ? (asinLinksRaw as Record<string, string>)
        : {};
    return {
      id: r.id,
      brand_name: r.brand_name,
      brand_logo_url: r.brand_logo_url ?? null,
      asins,
      asin_links: asinLinks,
      start_date: r.start_date,
      end_date: r.end_date ?? null,
      commission_rate_pct: Number(r.commission_rate_pct ?? 0),
      campaign_type: r.campaign_type,
      campaign_url: r.campaign_url ?? null,
      kw: r.kw ?? null,
      shop_url: resolveShopUrl(r),
      featured: primary ? cacheByAsin.get(primary) ?? null : null,
    };
  });

  return json({ data: { campaigns, count: campaigns.length } });
});
