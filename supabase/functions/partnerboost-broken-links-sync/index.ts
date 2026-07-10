// partnerboost-broken-links-sync — reads PartnerBoost get_broken_links (products
// whose tracking link is broken), flags the matching joined brands with
// partnerboost_merchants.broken_at so the affiliate_merchants view HIDES them
// from the Brands tab, and clears the flag when a brand recovers (no longer
// broken). Closes the stale-token gap between daily brand syncs.
//
// Body: { dry_run?:bool, debug?:bool }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const URL_EP = "https://app.partnerboost.com/api/datafeed/get_broken_links";
const PAGE_SIZE = 200;
const MAX_PAGES = 15;
// safety: if the feed would hide more than this many of our surfaced brands in one
// run, treat as suspicious and DON'T apply (report only) — avoids mass-hide on a glitch.
const MAX_HIDE_GUARD = 40;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
function str(v: unknown): string | null { if (v === null || v === undefined) return null; const s = String(v).trim(); return s === "" ? null : s; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!PB_TOKEN) return json({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const dryRun = body.dry_run === true; const debug = body.debug === true;

  const brokenBrandIds = new Set<string>();   // brand_ids with at least one broken (empty-tracking) product
  const allBrandIds = new Set<string>();       // every brand_id seen in the feed (for comparison)
  let fetched = 0; let apiOk = false; let apiErr: string | null = null;
  let page = 1;
  while (page <= MAX_PAGES) {
    const r = await fetch(URL_EP, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: PB_TOKEN, page, page_size: PAGE_SIZE }), signal: AbortSignal.timeout(25000) });
    const text = await r.text();
    let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
    const code = j?.status?.code ?? j?.code;
    if (r.status !== 200 || (code !== 0 && code !== "0")) { apiErr = `page${page}: http=${r.status} code=${code} ${text.slice(0,150)}`; break; }
    apiOk = true;
    const list: any[] = Array.isArray(j?.data?.list) ? j.data.list : (Array.isArray(j?.data) ? j.data : []);
    for (const p of list) {
      const bid = str(p.brand_id); if (!bid) continue;
      allBrandIds.add(bid);
      const track = str(p.tracking_url) ?? str(p.tracking_url_short);
      if (!track) brokenBrandIds.add(bid);   // empty tracking = broken
    }
    fetched += list.length;
    if (list.length < PAGE_SIZE) break;
    page++;
  }
  if (!apiOk) return json({ ok: false, api_error: apiErr }, 502);

  const ids = [...brokenBrandIds];
  // which of OUR joined brands match a broken brand_id
  const { data: matched } = await supabase.from("partnerboost_merchants")
    .select("id, pb_brand_id, merchant_name, brand_type, broken_at")
    .in("pb_brand_id", ids.length ? ids : ["__none__"]);
  const matchedList = matched ?? [];
  const wouldNewlyHide = matchedList.filter((m: any) => !m.broken_at).length;

  if (debug || dryRun) {
    return json({ ok: true, fetched, distinct_brands_in_feed: allBrandIds.size, broken_brand_ids: ids.length,
      our_matched_brands: matchedList.length, would_newly_hide: wouldNewlyHide,
      guard_max: MAX_HIDE_GUARD, sample_matched: matchedList.slice(0, 12).map((m: any) => ({ name: m.merchant_name, type: m.brand_type, already: !!m.broken_at })) });
  }

  if (wouldNewlyHide > MAX_HIDE_GUARD) {
    return json({ ok: false, guard_tripped: true, would_newly_hide: wouldNewlyHide, max: MAX_HIDE_GUARD, note: "Refused to mass-hide; inspect get_broken_links feed." }, 200);
  }

  const nowIso = new Date().toISOString();
  // flag matched broken brands not already flagged
  let flagged = 0;
  if (ids.length) {
    const { data: f } = await supabase.from("partnerboost_merchants").update({ broken_at: nowIso, updated_at: nowIso }).in("pb_brand_id", ids).is("broken_at", null).select("id");
    flagged = f?.length ?? 0;
  }
  // recover: clear broken_at for brands NO LONGER broken (only safe because fetch succeeded)
  let recovered = 0;
  let q = supabase.from("partnerboost_merchants").update({ broken_at: null, updated_at: nowIso }).not("broken_at", "is", null);
  if (ids.length) q = q.not("pb_brand_id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`);
  const { data: rec } = await q.select("id");
  recovered = rec?.length ?? 0;

  return json({ ok: true, fetched, distinct_brands_in_feed: allBrandIds.size, broken_brand_ids: ids.length, flagged, recovered, our_matched_brands: matchedList.length });
});
