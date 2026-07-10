// awin-feeds-discover — v3 (2026-06-05)
//
// v3: header-driven column index mapping. Awin migrated productdata.awin.com
// → legacydatafeeds.awin.com and the legacy CSV dropped the "Datafeed
// Format" column (12 cols vs prior 13). v2's hardcoded indices + length<13
// check caused 100% of rows to be skipped. v3 reads the header row and maps
// columns by NAME, so future Awin column adds/removes don't break parsing.
// datafeedFormat defaults to "csv" when the column is absent — the legacy
// endpoint only serves CSV anyway.
//
// v2: accepted feedlist_url in body / AWIN_FEEDLIST_URL env fallback.
// v1: initial.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FEEDLIST_URL_DEFAULT = Deno.env.get("AWIN_FEEDLIST_URL") ?? "";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

type FeedRow = {
  advertiserId: string;
  advertiserName: string;
  region: string;
  membershipStatus: string;
  datafeedFormat: string;
  feedId: string;
  feedName: string;
  language: string;
  vertical: string;
  lastImported: string;
  lastChecked: string;
  numProducts: number;
  url: string;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let field = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(field); field = ""; }
      else field += ch;
    }
  }
  out.push(field);
  return out;
}

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[\s"_-]/g, "");
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") return jsonRes({ error: "method_not_allowed" }, 405);

  let body: { feedlist_url?: string; dry_run?: boolean } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* */ }
  }
  const feedlistUrl = body.feedlist_url || FEEDLIST_URL_DEFAULT;
  const dryRun = body.dry_run === true;
  if (!feedlistUrl) return jsonRes({ error: "missing_feedlist_url", detail: "Pass feedlist_url in request body or set AWIN_FEEDLIST_URL env" }, 400);

  let csvText: string;
  try {
    const res = await fetch(feedlistUrl, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/csv, */*" },
      redirect: "follow",
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return jsonRes({ error: "feedlist_http", status: res.status }, 502);
    csvText = await res.text();
  } catch (e) {
    return jsonRes({ error: "feedlist_fetch_failed", detail: (e as Error).message }, 502);
  }

  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return jsonRes({ error: "empty_feedlist", lines: lines.length }, 502);

  // v3: build a column-name → index map from the header so we don't depend
  // on a specific column count or order. Awin's column lineup has changed
  // before and will likely change again.
  const headerFields = parseCsvLine(lines[0]).map(normalizeHeader);
  const idx = new Map<string, number>();
  headerFields.forEach((h, i) => idx.set(h, i));
  const need = (...names: string[]): number => {
    for (const n of names) {
      const v = idx.get(normalizeHeader(n));
      if (v !== undefined) return v;
    }
    return -1;
  };
  const cIdx = {
    advertiserId:     need("Advertiser ID", "advertiserid"),
    advertiserName:   need("Advertiser Name", "advertisername"),
    region:           need("Primary Region", "region"),
    membershipStatus: need("Membership Status", "status"),
    datafeedFormat:   need("Datafeed Format", "feedformat", "format"), // optional — legacy CSV omits
    feedId:           need("Feed ID", "feedid"),
    feedName:         need("Feed Name", "feedname"),
    language:         need("Language"),
    vertical:         need("Vertical"),
    lastImported:     need("Last Imported", "lastimported"),
    lastChecked:      need("Last Checked", "lastchecked"),
    numProducts:      need("No of products", "noofproducts", "numproducts"),
    url:              need("URL", "feedurl"),
  };
  const required: Array<keyof typeof cIdx> = [
    "advertiserId", "advertiserName", "membershipStatus",
    "feedId", "language", "numProducts", "url",
  ];
  const missing = required.filter((k) => cIdx[k] < 0);
  if (missing.length > 0) {
    return jsonRes({
      error: "feedlist_missing_columns",
      missing,
      header: headerFields,
      detail: "Awin may have changed the feedlist CSV layout again — required columns not found",
    }, 502);
  }

  const rows: FeedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    if (f.length < headerFields.length) continue;
    rows.push({
      advertiserId:     f[cIdx.advertiserId],
      advertiserName:   f[cIdx.advertiserName],
      region:           cIdx.region     >= 0 ? f[cIdx.region]     : "",
      membershipStatus: f[cIdx.membershipStatus],
      // v3: legacy CSV doesn't carry Datafeed Format. The legacy endpoint
      // only serves CSV, so default to that when the column is absent.
      datafeedFormat:   cIdx.datafeedFormat >= 0 ? f[cIdx.datafeedFormat] : "csv",
      feedId:           f[cIdx.feedId],
      feedName:         cIdx.feedName   >= 0 ? f[cIdx.feedName]   : "",
      language:         f[cIdx.language],
      vertical:         cIdx.vertical   >= 0 ? f[cIdx.vertical]   : "",
      lastImported:     cIdx.lastImported >= 0 ? f[cIdx.lastImported] : "",
      lastChecked:      cIdx.lastChecked  >= 0 ? f[cIdx.lastChecked]  : "",
      numProducts:      Number.parseInt(f[cIdx.numProducts], 10) || 0,
      url:              f[cIdx.url],
    });
  }

  // Eligible: joined + English (we're US/UK only)
  const eligible = rows.filter((r) =>
    r.membershipStatus === "active" &&
    (r.language === "English" || r.language === "") &&
    r.url.length > 0
  );

  const byAdvertiser = new Map<string, FeedRow[]>();
  for (const r of eligible) {
    const arr = byAdvertiser.get(r.advertiserId) ?? [];
    arr.push(r);
    byAdvertiser.set(r.advertiserId, arr);
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const updates: Array<{ awinmid: string; merchant_name: string; old_url: string | null; new_url: string; format: string; num_products: number; alternatives: number; changed: boolean; not_in_db?: boolean }> = [];

  for (const [advertiserId, candidates] of byAdvertiser) {
    candidates.sort((a, b) => {
      if (b.numProducts !== a.numProducts) return b.numProducts - a.numProducts;
      return b.lastImported.localeCompare(a.lastImported);
    });
    const winner = candidates[0];

    const { data: existing } = await supa.from("awin_merchants")
      .select("id, awinmid, merchant_name, awin_feed_url")
      .eq("awinmid", advertiserId)
      .maybeSingle();

    if (!existing) {
      updates.push({
        awinmid: advertiserId,
        merchant_name: winner.advertiserName,
        old_url: null,
        new_url: winner.url,
        format: winner.datafeedFormat,
        num_products: winner.numProducts,
        alternatives: candidates.length,
        changed: false,
        not_in_db: true,
      });
      continue;
    }

    const changed = existing.awin_feed_url !== winner.url;
    if (changed && !dryRun) {
      await supa.from("awin_merchants")
        .update({ awin_feed_url: winner.url, feed_last_error: null })
        .eq("id", existing.id);
    }
    updates.push({
      awinmid: existing.awinmid as string,
      merchant_name: existing.merchant_name as string,
      old_url: existing.awin_feed_url as string | null,
      new_url: winner.url,
      format: winner.datafeedFormat,
      num_products: winner.numProducts,
      alternatives: candidates.length,
      changed,
    });
  }

  return jsonRes({
    ok: true,
    dry_run: dryRun,
    csv_columns: headerFields.length,
    feedlist_rows_total: rows.length,
    eligible_rows: eligible.length,
    distinct_advertisers: byAdvertiser.size,
    changed: updates.filter((u) => u.changed).length,
    unchanged: updates.filter((u) => !u.changed && !u.not_in_db).length,
    not_in_db: updates.filter((u) => u.not_in_db).length,
    updates,
  });
});
