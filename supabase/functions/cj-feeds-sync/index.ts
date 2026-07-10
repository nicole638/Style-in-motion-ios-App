// cj-feeds-sync v4 — clothing-first paginated CJ product catalog sync.
// (v4: clothing keywords are single tokens chunked into groups of 10 — CJ counts
//  whitespace/hyphen-separated tokens toward its 10-keyword cap; phase/group/offset
//  checkpointed on cj_merchants.)
//
// Pulls from CJ's GraphQL ads.api.cj.com `products` query. Per-merchant currency
// comes from cj_merchants.feed_currency (USD by default, EUR for Mytheresa Intl).
//
// CLOTHING-FIRST BEHAVIOR:
//   CJ's `products` query treats a multi-keyword list as an OR-union and only the
//   `keywords` filter is authorized on this publisher account (googleProductCategoryIds
//   is NOT authorized). CJ also caps keywords at 10 per query (each whitespace/hyphen
//   token counts), so the apparel term list is single-token and processed in "keyword
//   groups" of <=10, each its own OR-union cursor. The "clothing" phase drains every
//   keyword group first (subject to CJ's hard 10,000-offset paging cap), then a
//   "general" phase pulls everything else.
//
//   Phase + keyword-group + offset are checkpointed on cj_merchants
//   (feed_phase, feed_keyword_index, feed_offset) so multi-day runs progress:
//   clothing[group0..N] -> general -> (wrap back to clothing).
//
//   CJ caps paging at offset+limit <= 10,000. When a slice hits that ceiling we
//   advance to the next keyword group / phase rather than erroring.
//
// POST body:
//   { merchant_id: uuid,
//     max_products?: int,        // default 5000, clamped 1..20000
//     reset_offset?: bool,       // restart at clothing phase, group 0, offset 0
//     refresh_matview?: bool,    // default true
//     clothing_first?: bool,     // default true; false => start in general phase
//     keywords?: string[] }      // override the default clothing keyword list

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CJ_GRAPHQL = "https://ads.api.cj.com/query";

const PAGE_SIZE = 500;            // CJ products query max per call
const UPSERT_BATCH = 250;         // tune for Supabase upsert latency
const MAX_REACHABLE_OFFSET = 10000; // CJ hard cap: offset + limit must be <= 10,000
const MAX_KEYWORDS_PER_QUERY = 10;  // CJ hard cap: "limit keywords to 10 or fewer"

// OR-union of apparel terms. Curated toward unambiguous, SINGLE-TOKEN clothing nouns:
// CJ counts each whitespace/hyphen-separated token toward its "10 keywords or fewer"
// limit, so multi-word phrases ("tank top") and hyphenated terms ("t-shirt") would
// blow the budget. Processed in chunks of 10 ("keyword groups"); each group is its
// own OR-union cursor, paged independently.
const CLOTHING_KEYWORDS = [
  "dress", "gown", "shirt", "tee", "blouse", "top", "sweater", "knitwear", "cardigan", "hoodie",
  "sweatshirt", "sweatpants", "joggers", "jacket", "coat", "blazer", "outerwear", "vest", "pants", "trousers",
  "jeans", "leggings", "shorts", "skirt", "jumpsuit", "romper", "activewear", "loungewear", "swimwear", "lingerie",
];

// CJ counts whitespace/hyphen-separated tokens individually, so flatten any
// multi-word/hyphenated entries into single tokens and de-duplicate.
function normalizeKeywords(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    for (const tok of String(raw).toLowerCase().split(/[\s\-]+/)) {
      const t = tok.trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function gqlStrList(items: string[]): string {
  // Render a GraphQL list of strings: ["a","b"] with JSON-escaped values.
  return "[" + items.map((s) => JSON.stringify(s)).join(",") + "]";
}

async function cjQuery(pat: string, query: string): Promise<any> {
  const r = await fetch(CJ_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`cj_query_${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  let body: {
    merchant_id?: string; max_products?: number; reset_offset?: boolean;
    refresh_matview?: boolean; clothing_first?: boolean; keywords?: string[];
  } = {};
  try { body = await req.json(); } catch { /* */ }
  if (!body.merchant_id) return jsonRes({ ok: false, error: "missing_merchant_id" }, 400);

  const maxProducts = Math.min(Math.max(body.max_products ?? 5000, 1), 20000);
  const resetOffset = body.reset_offset === true;
  const doRefresh = body.refresh_matview !== false;
  const clothingFirst = body.clothing_first !== false; // default true
  const clothingKeywords = normalizeKeywords(
    (Array.isArray(body.keywords) && body.keywords.length > 0)
      ? body.keywords.map((k) => String(k)).filter(Boolean)
      : CLOTHING_KEYWORDS,
  );

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startedAt = new Date();

  // Load merchant + config (now includes feed_phase + feed_keyword_index)
  const { data: merchant, error: mErr } = await supa.from("cj_merchants")
    .select("id, cj_advertiser_id, merchant_name, feed_currency, feed_offset, feed_phase, feed_keyword_index")
    .eq("id", body.merchant_id).eq("status", "active").is("archived_at", null).maybeSingle();
  if (mErr) return jsonRes({ error: "load_merchant_failed", detail: mErr.message }, 500);
  if (!merchant) return jsonRes({ ok: false, error: "merchant_not_found_or_inactive" }, 404);

  const { data: cfg } = await supa.from("cj_publisher_config")
    .select("cid, personal_access_token").eq("is_default", true).maybeSingle();
  if (!cfg?.personal_access_token || !cfg?.cid) {
    return jsonRes({ ok: false, error: "no_cj_publisher_config" }, 500);
  }

  // Open audit run
  const { data: run } = await supa.from("cj_feed_runs").insert({
    merchant_id: merchant.id, started_at: startedAt.toISOString(),
  }).select("id").single();
  const runId: string | null = run?.id ?? null;

  // Resolve starting phase + offset
  let phase: "clothing" | "general" =
    resetOffset
      ? (clothingFirst ? "clothing" : "general")
      : ((merchant.feed_phase as "clothing" | "general") ?? (clothingFirst ? "clothing" : "general"));
  if (!clothingFirst && phase === "clothing" && resetOffset) phase = "general";
  let offset = resetOffset ? 0 : (merchant.feed_offset ?? 0);

  // Clothing keywords are processed in groups of <= MAX_KEYWORDS_PER_QUERY (CJ limit).
  const keywordGroups = chunk(clothingKeywords, MAX_KEYWORDS_PER_QUERY);
  let kwIndex = resetOffset ? 0 : (merchant.feed_keyword_index ?? 0);
  if (kwIndex < 0 || kwIndex >= keywordGroups.length) kwIndex = 0;
  // If we resumed into the clothing phase but there are no keyword groups, skip to general.
  if (phase === "clothing" && keywordGroups.length === 0) { phase = "general"; offset = 0; }

  const startPhase = phase;
  const startOffset = offset;
  const startKwIndex = kwIndex;
  let totalCount = 0;
  let clothingSeen = 0;
  let generalSeen = 0;
  let productsSeen = 0;
  let productsUpdated = 0;
  let errorMessage: string | null = null;
  let cycleComplete = false;
  let pageBatch: any[] = [];
  const seenIds = new Set<string>();

  const flush = async (): Promise<string | null> => {
    if (pageBatch.length === 0) return null;
    const { error } = await supa.from("cj_products")
      .upsert(pageBatch, { onConflict: "merchant_id,product_id_in_feed" });
    if (error) return `upsert: ${error.message.slice(0, 200)}`;
    productsUpdated += pageBatch.length;
    pageBatch = [];
    await new Promise((r) => setTimeout(r, 0));
    return null;
  };

  // Advance the cursor when the current slice is exhausted or hits the 10k cap.
  // In the clothing phase, step through keyword groups before falling to general.
  let stop = false;
  const advance = () => {
    if (phase === "clothing") {
      kwIndex++;
      offset = 0;
      if (kwIndex >= keywordGroups.length) { phase = "general"; kwIndex = 0; }
    } else {
      cycleComplete = true;
      phase = "clothing";
      kwIndex = 0;
      offset = 0;
      stop = true; // full cycle done for this run
    }
  };

  try {
    while (productsSeen < maxProducts && !stop) {
      const remainingForRun = maxProducts - productsSeen;
      const limit = Math.min(PAGE_SIZE, remainingForRun);

      // CJ paging ceiling: if we cannot fetch a full window within 10k, treat the
      // current slice as exhausted and advance instead of triggering cj_query_400.
      if (offset + limit > MAX_REACHABLE_OFFSET) { advance(); continue; }

      const keywordsClause = phase === "clothing"
        ? `, keywords:${gqlStrList(keywordGroups[kwIndex])}`
        : "";
      const q = `{ products(companyId:"${cfg.cid}", partnerIds:["${merchant.cj_advertiser_id}"], currency:"${merchant.feed_currency}"${keywordsClause}, limit:${limit}, offset:${offset}){ totalCount resultList{ id title link imageLink brand description price{amount currency} adId } } }`;
      const data = await cjQuery(cfg.personal_access_token, q);
      if (data.errors) {
        errorMessage = JSON.stringify(data.errors).slice(0, 300);
        break;
      }
      totalCount = data.data?.products?.totalCount ?? totalCount;
      const rows: any[] = data.data?.products?.resultList ?? [];

      if (rows.length === 0) {
        // End of this slice's result set — advance keyword group / phase / wrap cycle.
        advance();
        continue;
      }

      for (const p of rows) {
        const pid = p.id;
        if (!pid || seenIds.has(pid)) continue;
        seenIds.add(pid);
        const price = p.price || {};
        const img = (p.imageLink || "").trim();
        pageBatch.push({
          merchant_id: merchant.id,
          product_id_in_feed: pid,
          name: (p.title || "").slice(0, 500),
          description: (p.description || "").slice(0, 2000),
          brand: p.brand || null,
          price: price.amount ? Number(price.amount) : null,
          search_price: price.amount ? Number(price.amount) : null,
          currency: price.currency || merchant.feed_currency,
          in_stock: true,
          product_url: p.link || null,
          cj_deep_link: p.link || null, // wrap happens at click time via affiliate-wrap-url
          image_urls: img ? [img] : [],
          feed_run_id: runId,
          last_seen_at: new Date().toISOString(),
          removed_at: null,
          updated_at: new Date().toISOString(),
        });
        productsSeen++;
        if (phase === "clothing") clothingSeen++; else generalSeen++;
        if (pageBatch.length >= UPSERT_BATCH) {
          const err = await flush();
          if (err) { errorMessage = err; break; }
        }
      }
      if (errorMessage) break;

      offset += rows.length;
      if (rows.length < limit) {
        // Last page of this slice — advance keyword group / phase / wrap cycle.
        advance();
        continue;
      }
      await new Promise((r) => setTimeout(r, 100)); // be polite to CJ
    }
    if (pageBatch.length > 0 && !errorMessage) {
      const err = await flush();
      if (err) errorMessage = err;
    }
  } catch (e) {
    errorMessage = `fetch_or_upsert: ${(e as Error).message.slice(0, 200)}`;
  }

  // Update merchant checkpoint + state
  await supa.from("cj_merchants").update({
    feed_offset: offset,
    feed_phase: phase,
    feed_keyword_index: kwIndex,
    feed_total_count: totalCount,
    feed_last_synced_at: new Date().toISOString(),
    feed_last_product_count: productsSeen,
    feed_last_error: errorMessage,
  }).eq("id", merchant.id);

  if (runId) {
    await supa.from("cj_feed_runs").update({
      completed_at: new Date().toISOString(),
      products_seen: productsSeen,
      products_updated: productsUpdated,
      error_message: errorMessage,
      notes: `start=${startPhase}[kw${startKwIndex}]@${startOffset} end=${phase}[kw${kwIndex}]@${offset} clothing=${clothingSeen} general=${generalSeen} totalCount=${totalCount} cycleComplete=${cycleComplete}`,
    }).eq("id", runId);
  }

  // Refresh affiliate_products matview so iOS Brands tab picks up new products
  let matviewRefreshed = false;
  let refreshError: string | null = null;
  if (doRefresh && !errorMessage && productsSeen > 0) {
    try {
      const { error } = await supa.rpc("refresh_affiliate_products", { concurrent: false });
      if (error) refreshError = error.message.slice(0, 200);
      else matviewRefreshed = true;
    } catch (e) {
      refreshError = (e as Error).message.slice(0, 200);
    }
  }

  return jsonRes({
    ok: !errorMessage,
    merchant_name: merchant.merchant_name,
    cj_advertiser_id: merchant.cj_advertiser_id,
    feed_currency: merchant.feed_currency,
    start_phase: startPhase,
    end_phase: phase,
    start_keyword_group: startKwIndex,
    end_keyword_group: kwIndex,
    keyword_groups_total: keywordGroups.length,
    products_seen: productsSeen,
    clothing_seen: clothingSeen,
    general_seen: generalSeen,
    products_updated: productsUpdated,
    start_offset: startOffset,
    end_offset: offset,
    total_count: totalCount,
    cycle_complete: cycleComplete,
    matview_refreshed: matviewRefreshed,
    refresh_error: refreshError,
    error: errorMessage,
  });
});
