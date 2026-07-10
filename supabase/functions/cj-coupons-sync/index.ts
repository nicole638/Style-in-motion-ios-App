// cj-coupons-sync v3 — CJ Link Search across MULTIPLE promotion types
// (coupon + sale/discount + free shipping), advertiser-ids=joined, into
// brand_offers (network='cj', source='api'). Tags brand_offers.type per promo
// type. Dedup: coded offers key on advertiser+code (collapses banner variants);
// code-less sales key on advertiser+normalized-title. merchant_id via
// cj_merchants.cj_advertiser_id. Tombstones unseen cj api rows.
//
// Body: { dry_run?:bool, debug?:bool, promotion_types?:string[], max_pages?:int }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CJ_LINKSEARCH = "https://link-search.api.cj.com/v2/link-search";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

// CJ promotion-type value -> our brand_offers.type
const PROMO_TYPE_MAP: Record<string, string> = {
  "coupon": "coupon",
  "sale/discount": "sale",
  "free shipping": "free_shipping",
};
const DEFAULT_PROMO_TYPES = ["coupon", "sale/discount", "free shipping"];

function decodeXml(s: string) { return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)); }
function stripCdata(s: string) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim(); }
function tag(block: string, name: string): string | null { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); if (!m) return null; const v = decodeXml(stripCdata(m[1])); return v === "" ? null : v; }
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
function cleanTitle(t: string) { return t.replace(/\s*[-–—]\s*banner[\s_]*\d*\s*$/i, "").replace(/\s*\(banner[^)]*\)\s*$/i, "").replace(/\s+/g, " ").trim(); }
function sanitizeCode(c: string | null): string | null { if (!c) return null; const t = c.trim(); if (!t || t.length > 40) return null; if (/^(no\b|not\b|none\b|n\/?a\b|no code|not code|see |click |automatic|auto-?appl)/i.test(t)) return null; return t; }
async function shortHash(s: string) { const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)); return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join(""); }

async function cjFetch(url: string, pat: string): Promise<{ status: number; text: string }> {
  let res = await fetch(url, { headers: { "Authorization": `Bearer ${pat}` }, signal: AbortSignal.timeout(25000) });
  if (res.status === 401 || res.status === 403) res = await fetch(url, { headers: { "Authorization": pat }, signal: AbortSignal.timeout(25000) });
  return { status: res.status, text: await res.text() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const dryRun = body.dry_run === true; const debug = body.debug === true;
  const maxPages = debug ? 1 : Math.min(50, Math.max(1, parseInt(String(body.max_pages ?? 20), 10) || 20));
  const promoTypes: string[] = Array.isArray(body.promotion_types) && body.promotion_types.length ? body.promotion_types : DEFAULT_PROMO_TYPES;

  const { data: cfg } = await supabase.from("cj_publisher_config").select("website_id, personal_access_token").eq("is_default", true).maybeSingle();
  if (!cfg?.personal_access_token || !cfg?.website_id) return json({ error: "no_cj_config" }, 500);
  const pat = cfg.personal_access_token; const websiteId = String(cfg.website_id);

  const { data: merchants } = await supabase.from("cj_merchants").select("id, cj_advertiser_id");
  const advMap = new Map<string, string>(); for (const m of merchants ?? []) advMap.set(String(m.cj_advertiser_id), String(m.id));

  const startedAt = new Date().toISOString();
  const rows: any[] = []; let unmatched = 0; const perType: Record<string, number> = {}; const typeErrors: Record<string, string> = {};
  const recordsPerPage = 100;

  for (const pt of promoTypes) {
    const offerType = PROMO_TYPE_MAP[pt] ?? "sale";
    let page = 1; let typeCount = 0;
    while (page <= maxPages) {
      const url = `${CJ_LINKSEARCH}?website-id=${encodeURIComponent(websiteId)}&advertiser-ids=joined&promotion-type=${encodeURIComponent(pt)}&records-per-page=${recordsPerPage}&page-number=${page}`;
      const { status, text } = await cjFetch(url, pat);
      if (status !== 200) { if (page === 1) typeErrors[pt] = `http_${status}: ${text.slice(0, 120)}`; break; }
      const links = text.match(/<link\b[^>]*>[\s\S]*?<\/link>/gi) ?? [];
      for (const block of links) {
        const advId = tag(block, "advertiser-id");
        const linkId = tag(block, "link-id");
        const linkName = tag(block, "link-name");
        const desc = tag(block, "description");
        const code = sanitizeCode(tag(block, "coupon-code"));
        const startD = tag(block, "promotion-start-date");
        const endD = tag(block, "promotion-end-date");
        const clickUrl = tag(block, "clickUrl");
        const category = tag(block, "category");
        if (!linkId && !clickUrl) continue;
        const merchantId = advId ? (advMap.get(String(advId)) ?? null) : null;
        if (!merchantId) unmatched++;
        const now = Date.now();
        const end = endD ? Date.parse(endD) : NaN;
        const start = startD ? Date.parse(startD) : NaN;
        if (Number.isFinite(end) && end < now) continue;
        let status2 = "active";
        if (Number.isFinite(start) && start > now) status2 = "upcoming";
        else if (Number.isFinite(end) && end - now < 7 * 864e5) status2 = "expiringSoon";
        const title = cleanTitle(linkName || desc || "Offer").slice(0, 300);
        // dedup key: coded -> advertiser+code; code-less -> advertiser+title-hash (per type)
        const promotionId = code
          ? `cj:api:${advId}:${code.toLowerCase()}`
          : `cj:api:${offerType}:${advId}:${await shortHash(title.toLowerCase())}`;
        rows.push({
          promotion_id: promotionId, merchant_id: merchantId, network: "cj", network_mid: advId ? String(advId) : null,
          source: "api", type: offerType, title,
          description: desc ? desc.slice(0, 1024) : null, terms: null, voucher_code: code,
          start_date: Number.isFinite(start) ? new Date(start).toISOString() : null,
          end_date: Number.isFinite(end) ? new Date(end).toISOString() : null,
          status: status2, url: clickUrl ?? null, url_tracking: clickUrl ?? null, exclusive: false, all_regions: true,
          categories: category ? [category] : [], last_seen_at: startedAt, removed_at: null, updated_at: startedAt,
        });
        typeCount++;
      }
      if (links.length < recordsPerPage) break;
      page++;
    }
    perType[pt] = typeCount;
  }

  // collapse dupes: shortest (cleanest) title per promotion_id
  rows.sort((a, b) => a.title.length - b.title.length);
  const seen = new Set<string>(); const dedup = rows.filter((r) => seen.has(r.promotion_id) ? false : (seen.add(r.promotion_id), true));

  if (debug || dryRun) return json({ ok: true, per_type: perType, type_errors: typeErrors, total_links: rows.length, deduped: dedup.length, unmatched_merchant: unmatched, sample: dedup.slice(0, 6).map((r) => ({ type: r.type, title: r.title, code: r.voucher_code })) });

  let upserted = 0; const errs: string[] = [];
  for (let i = 0; i < dedup.length; i += 200) { const batch = dedup.slice(i, i + 200); const { error } = await supabase.from("brand_offers").upsert(batch, { onConflict: "promotion_id" }); if (error) errs.push(error.message.slice(0, 150)); else upserted += batch.length; }
  const { data: tomb } = await supabase.from("brand_offers").update({ removed_at: startedAt, updated_at: startedAt }).eq("network", "cj").eq("source", "api").is("removed_at", null).lt("last_seen_at", startedAt).select("id");
  return json({ ok: errs.length === 0, per_type: perType, type_errors: typeErrors, upserted, unmatched_merchant: unmatched, tombstoned: tomb?.length ?? 0, errors: errs });
});
