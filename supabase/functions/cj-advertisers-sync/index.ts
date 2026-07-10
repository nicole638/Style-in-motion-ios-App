// cj-advertisers-sync v5 — skip metadata_locked merchants so the CJ sync never
// overwrites manually-managed cards. The PartnerBoost-fed Amazon card is CJ
// advertiser 7096926 (joined, so CJ returns it) but its display metadata is
// owned by us and its products come from PartnerBoost's API — letting this sync
// upsert it clobbered the name/logo/category nightly. metadata_locked=true on
// cj_merchants now excludes such rows from the upsert.
//
// (v4: swapped Clearbit — sunset — for icon.horse, a no-auth brand-logo CDN.)
//
// CJ's Advertiser Lookup doesn't return a logo_url (Awin and Rakuten both do).
// For consistent iOS Brands-tab tile rendering we synthesize one from
// icon.horse — returns the brand logo at a usable size + handles redirects.
//
// Calls CJ's Advertiser Lookup v2 REST API with `advertiser-ids=joined`.
// Upserts each row into cj_merchants keyed by cj_advertiser_id.
//
// Query params:
//   ?dry_run=1          — fetch + log but don't upsert
//   ?include_pending=1  — also upsert relationship-status='pending' rows
//   ?max_pages=N        — safety cap (default 50 = 5000 records)
//
// History:
//   v1: initial; mis-mapped advertiser-status.
//   v2: fixed status normalization for the modern 'Active' value.
//   v3: added Clearbit logo — dead service.
//   v4: swap to icon.horse.
//   v5: honor cj_merchants.metadata_locked (skip PartnerBoost-Amazon 7096926 etc.).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CJ_ADVERTISER_LOOKUP = "https://advertiser-lookup.api.cj.com/v2/advertiser-lookup";
const RECORDS_PER_PAGE = 100;
const THROTTLE_MS = 250;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function normalizeDomain(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  try { return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
}

function logoUrlFor(domain: string | null): string | null {
  if (!domain) return null;
  return `https://icon.horse/icon/${domain}`;
}

function isAccountActive(raw: string | null | undefined): boolean {
  const v = (raw ?? "").toLowerCase().replace(/[_\s]+/g, "");
  return v === "active" || v === "inbusiness";
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  const raw = decodeXmlEntities(m[1].trim());
  return raw.length === 0 ? null : raw;
}

function xmlPrimaryCategory(advertiserXml: string): string | null {
  const cat = advertiserXml.match(/<primary-category>([\s\S]*?)<\/primary-category>/i)?.[1];
  if (!cat) return null;
  const parent = cat.match(/<parent>([^<]*)<\/parent>/i)?.[1]?.trim();
  const child = cat.match(/<child>([^<]*)<\/child>/i)?.[1]?.trim();
  if (!parent && !child) return null;
  return parent && child ? `${parent} / ${child}` : (parent ?? child ?? null);
}

interface AdvertiserParsed {
  advertiser_id: string;
  advertiser_name: string;
  program_url: string | null;
  relationship_status: string | null;
  account_status: string | null;
  network_rank: string | null;
  seven_day_epc: string | null;
  three_month_epc: string | null;
  performance_incentives: string | null;
  primary_category: string | null;
  mobile_tracking_certified: string | null;
  cookieless_tracking_enabled: string | null;
  language: string | null;
}

function parseAdvertisers(xmlBody: string): AdvertiserParsed[] {
  const out: AdvertiserParsed[] = [];
  const advRe = /<advertiser>([\s\S]*?)<\/advertiser>/gi;
  let m: RegExpExecArray | null;
  while ((m = advRe.exec(xmlBody)) !== null) {
    const body = m[1];
    const id = xmlText(body, "advertiser-id");
    const name = xmlText(body, "advertiser-name");
    if (!id || !name) continue;
    out.push({
      advertiser_id: id,
      advertiser_name: name,
      program_url: xmlText(body, "program-url"),
      relationship_status: xmlText(body, "relationship-status"),
      account_status: xmlText(body, "account-status"),
      network_rank: xmlText(body, "network-rank"),
      seven_day_epc: xmlText(body, "seven-day-epc"),
      three_month_epc: xmlText(body, "three-month-epc"),
      performance_incentives: xmlText(body, "performance-incentives"),
      primary_category: xmlPrimaryCategory(body),
      mobile_tracking_certified: xmlText(body, "mobile-tracking-certified"),
      cookieless_tracking_enabled: xmlText(body, "cookieless-tracking-enabled"),
      language: xmlText(body, "language"),
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  const url = new URL(req.url);
  const isDryRun = url.searchParams.get("dry_run") === "1";
  const includePending = url.searchParams.get("include_pending") === "1";
  const maxPages = Math.min(
    Math.max(parseInt(url.searchParams.get("max_pages") ?? "50", 10), 1),
    100,
  );
  const startedAt = new Date().toISOString();

  const { data: cfg, error: cfgErr } = await supabase
    .from("cj_publisher_config")
    .select("cid, personal_access_token")
    .eq("is_default", true)
    .maybeSingle();
  if (cfgErr || !cfg) {
    return new Response(JSON.stringify({
      error: "no_cj_publisher_config",
      detail: cfgErr?.message ?? "no default row",
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  if (!cfg.personal_access_token || !cfg.cid) {
    return new Response(JSON.stringify({
      error: "missing_creds",
      detail: "cj_publisher_config row missing PAT or CID",
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Manually-managed merchants: CJ returns them as joined, but we own their
  // display metadata (e.g. the PartnerBoost-fed Amazon card, advertiser 7096926).
  // Skip them so the CJ sync never clobbers name/logo/category.
  const { data: lockedRows } = await supabase
    .from("cj_merchants").select("cj_advertiser_id").eq("metadata_locked", true);
  const lockedIds = new Set((lockedRows ?? []).map((r: { cj_advertiser_id: string }) => r.cj_advertiser_id));

  const allAdvertisers: AdvertiserParsed[] = [];
  const errors: Array<{ where: string; detail: string }> = [];
  let pagesFetched = 0;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const params = new URLSearchParams({
      "requestor-cid": cfg.cid,
      "advertiser-ids": "joined",
      "records-per-page": String(RECORDS_PER_PAGE),
      "page-number": String(pageNumber),
    });
    let resp: Response;
    try {
      resp = await fetch(`${CJ_ADVERTISER_LOOKUP}?${params}`, {
        headers: {
          "Authorization": `Bearer ${cfg.personal_access_token}`,
          "Accept": "application/xml",
        },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      errors.push({ where: `fetch page ${pageNumber}`, detail: (e as Error).message });
      break;
    }
    if (!resp.ok) {
      const txt = await resp.text();
      errors.push({
        where: `http page ${pageNumber}`,
        detail: `status=${resp.status} body=${txt.slice(0, 400)}`,
      });
      break;
    }
    const xml = await resp.text();
    pagesFetched++;

    const totalMatch = xml.match(/<advertisers[^>]*\btotal-matched="(\d+)"/i);
    const recordsReturnedMatch = xml.match(/<advertisers[^>]*\brecords-returned="(\d+)"/i);
    const totalMatched = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    const recordsReturned = recordsReturnedMatch ? parseInt(recordsReturnedMatch[1], 10) : 0;

    const pageAdvertisers = parseAdvertisers(xml);
    allAdvertisers.push(...pageAdvertisers);

    const cumulative = pageNumber * RECORDS_PER_PAGE;
    if (recordsReturned < RECORDS_PER_PAGE || cumulative >= totalMatched) break;
    await sleep(THROTTLE_MS);
  }

  let processed = 0, upserted = 0, skipped = 0;
  for (const a of allAdvertisers) {
    processed++;
    if (lockedIds.has(a.advertiser_id)) { skipped++; continue; }  // manually-managed
    const isJoined = (a.relationship_status ?? "").toLowerCase() === "joined";
    if (!includePending && !isJoined) { skipped++; continue; }
    if (isDryRun) continue;

    const domain = normalizeDomain(a.program_url);
    const accountIsActive = isAccountActive(a.account_status);

    const status =
      isJoined && accountIsActive ? "active"
      : isJoined ? "paused"
      : "pending";

    const row = {
      cj_advertiser_id: a.advertiser_id,
      merchant_name: a.advertiser_name,
      domain,
      partnership_status: a.relationship_status ?? "unknown",
      advertiser_status: a.account_status,
      status,
      primary_category: a.primary_category,
      logo_url: logoUrlFor(domain),
      click_through_url: a.program_url,
      partnerships_last_synced_at: startedAt,
      details_last_synced_at: startedAt,
      updated_at: startedAt,
    };

    const { error: upErr } = await supabase
      .from("cj_merchants")
      .upsert(row, { onConflict: "cj_advertiser_id" });
    if (upErr) {
      errors.push({
        where: `upsert advertiser ${a.advertiser_id}`,
        detail: upErr.message,
      });
      continue;
    }
    upserted++;
  }

  return new Response(JSON.stringify({
    ok: errors.length === 0,
    dry_run: isDryRun,
    pages_fetched: pagesFetched,
    total_advertisers_returned: allAdvertisers.length,
    processed,
    upserted,
    skipped,
    locked_skipped: lockedIds.size,
    errors,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  }, null, 2), {
    status: errors.length === 0 ? 200 : 207,
    headers: { "Content-Type": "application/json" },
  });
});
