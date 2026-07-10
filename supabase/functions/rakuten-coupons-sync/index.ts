// rakuten-coupons-sync — Rakuten Coupon Feed (/coupon/1.0) into brand_offers
// (network='rakuten', source='api'). v3: DEDUP — promotion_id hashes on
// advertiser+normalized-offer-text only (drops clickurl), so the same offer
// surfaced via multiple links collapses to one. merchant_id via
// rakuten_merchants.rakuten_mid. Reuses rakuten-events-sync OAuth flow.
//
// Body: { dry_run?:bool, debug?:bool, sid?:str, max_pages?:int }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAKUTEN_API = "https://api.linksynergy.com";
const RAKUTEN_TOKEN_ENDPOINT = "https://api.linksynergy.com/token";
const CACHE_SKEW_MS = 60_000;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

interface ConfigRow { sid: string; client_id: string; client_secret: string; access_token: string | null; access_token_expires_at: string | null; refresh_token: string | null; }
async function loadConfig(sid: string | null): Promise<ConfigRow> { let q = supabase.from("rakuten_publisher_config").select("*"); q = sid ? q.eq("sid", sid) : q.eq("is_default", true); const { data, error } = await q.maybeSingle(); if (error) throw new Error(`config: ${error.message}`); if (!data) throw new Error("no rakuten_publisher_config"); return data as ConfigRow; }
async function callTokenEndpoint(tokenKey: string, body: URLSearchParams) { const res = await fetch(RAKUTEN_TOKEN_ENDPOINT, { method: "POST", headers: { "Authorization": `Bearer ${tokenKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }); if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0,200)}`); return await res.json() as { access_token: string; refresh_token: string; expires_in: number }; }
async function ensureValidToken(cfg: ConfigRow): Promise<string> { const now = Date.now(); const exp = cfg.access_token_expires_at ? new Date(cfg.access_token_expires_at).getTime() : 0; if (cfg.access_token && exp - now > CACHE_SKEW_MS) return cfg.access_token; const tokenKey = btoa(`${cfg.client_id}:${cfg.client_secret}`); let tok; if (cfg.refresh_token) { try { tok = await callTokenEndpoint(tokenKey, new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refresh_token, scope: cfg.sid })); } catch (e) { console.log(`refresh failed ${e}`); } } if (!tok) tok = await callTokenEndpoint(tokenKey, new URLSearchParams({ scope: cfg.sid })); const newExp = new Date(Date.now() + tok.expires_in * 1000).toISOString(); await supabase.from("rakuten_publisher_config").update({ access_token: tok.access_token, access_token_expires_at: newExp, refresh_token: tok.refresh_token, updated_at: new Date().toISOString() }).eq("sid", cfg.sid); return tok.access_token; }

function decodeXml(s: string) { return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)); }
function stripCdata(s: string) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim(); }
function tag(block: string, name: string): string | null { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); if (!m) return null; const v = decodeXml(stripCdata(m[1])); return v === "" ? null : v; }
async function shortHash(s: string) { const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)); return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const dryRun = body.dry_run === true; const debug = body.debug === true; const sid = body.sid ?? null;
  const maxPages = debug ? 1 : Math.min(50, Math.max(1, parseInt(String(body.max_pages ?? 30), 10) || 30));

  let cfg: ConfigRow, token: string;
  try { cfg = await loadConfig(sid); token = await ensureValidToken(cfg); } catch (e) { return json({ error: "auth", detail: String(e) }, 502); }

  const { data: merchants } = await supabase.from("rakuten_merchants").select("id, rakuten_mid");
  const midMap = new Map<string, string>(); for (const m of merchants ?? []) midMap.set(String(m.rakuten_mid), String(m.id));

  const startedAt = new Date().toISOString();
  let page = 1, totalPages = 1; const blocks: string[] = [];
  while (page <= Math.min(maxPages, totalPages)) {
    const res = await fetch(`${RAKUTEN_API}/coupon/1.0?resultsperpage=500&pagenumber=${page}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/xml" }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) { const t = await res.text(); return json({ error: "coupon_fetch", status: res.status, body: t.slice(0, 400) }, 502); }
    const xml = await res.text();
    const tp = xml.match(/<TotalPages>\s*(\d+)\s*<\/TotalPages>/i); totalPages = tp ? parseInt(tp[1], 10) : 1;
    const links = xml.match(/<link\b[^>]*>[\s\S]*?<\/link>/gi) ?? [];
    blocks.push(...links);
    if (links.length === 0) break;
    page++;
  }

  const rows: any[] = []; let unmatched = 0;
  for (const block of blocks) {
    const advId = tag(block, "advertiserid");
    const desc = tag(block, "offerdescription");
    const code = tag(block, "couponcode");
    const restriction = tag(block, "couponrestriction");
    const startD = tag(block, "offerstartdate");
    const endD = tag(block, "offerenddate");
    const clickurl = tag(block, "clickurl");
    const catName = tag(block, "category");
    if (!advId && !clickurl) continue;
    const merchantId = advId ? (midMap.get(String(advId)) ?? null) : null;
    if (!merchantId) unmatched++;
    const now = Date.now();
    const end = endD ? Date.parse(endD) : NaN;
    const start = startD ? Date.parse(startD) : NaN;
    if (Number.isFinite(end) && end < now) continue;
    let status = "active";
    if (Number.isFinite(start) && start > now) status = "upcoming";
    else if (Number.isFinite(end) && end - now < 7 * 864e5) status = "expiringSoon";
    // DEDUP KEY: advertiser + normalized offer text (+ code) — not the clickurl.
    const normDesc = (desc ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const hash = await shortHash(`${advId}|${normDesc}|${code ?? ""}`);
    const promotionId = `rakuten:api:${advId ?? "x"}:${hash}`;
    rows.push({
      promotion_id: promotionId, merchant_id: merchantId, network: "rakuten", network_mid: advId ? String(advId) : null,
      source: "api", type: "coupon", title: (desc ?? "Offer").slice(0, 300),
      description: desc ? desc.slice(0, 1024) : null, terms: restriction ? restriction.slice(0, 4000) : null, voucher_code: code || null,
      start_date: Number.isFinite(start) ? new Date(start).toISOString() : null,
      end_date: Number.isFinite(end) ? new Date(end).toISOString() : null,
      status, url: clickurl ?? null, url_tracking: clickurl ?? null, exclusive: false, all_regions: true,
      categories: catName ? [catName] : [], last_seen_at: startedAt, removed_at: null, updated_at: startedAt,
    });
  }

  const seen = new Set<string>(); const dedup = rows.filter((r) => seen.has(r.promotion_id) ? false : (seen.add(r.promotion_id), true));
  if (debug) return json({ ok: true, total_links: blocks.length, deduped: dedup.length, unmatched_merchant: unmatched, total_pages: totalPages, sample: dedup.slice(0, 3) });
  if (dryRun) return json({ ok: true, total_links: blocks.length, would_upsert: dedup.length, unmatched_merchant: unmatched });

  let upserted = 0; const errs: string[] = [];
  for (let i = 0; i < dedup.length; i += 200) { const batch = dedup.slice(i, i + 200); const { error } = await supabase.from("brand_offers").upsert(batch, { onConflict: "promotion_id" }); if (error) errs.push(error.message.slice(0, 150)); else upserted += batch.length; }
  const { data: tomb } = await supabase.from("brand_offers").update({ removed_at: startedAt, updated_at: startedAt }).eq("network", "rakuten").eq("source", "api").is("removed_at", null).lt("last_seen_at", startedAt).select("id");
  return json({ ok: errs.length === 0, total_links: blocks.length, upserted, unmatched_merchant: unmatched, tombstoned: tomb?.length ?? 0, errors: errs });
});
