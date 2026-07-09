import zlib from "node:zlib";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase";

/**
 * Node/Hono port of the Supabase edge function `awin-feeds-sync`.
 *
 * WHY THIS EXISTS: some Awin product feeds (starting with Under Armour US,
 * a 4.3MB gzip that inflates to ~72MB / 45k rows) OOM the Deno edge runtime
 * when decompressed. The Node runtime + `zlib.gunzipSync` handles the
 * multi-member gzip without issue, so oversized feeds are ingested here
 * instead. This is ADDITIVE — the edge function is unchanged and still owns
 * every merchant NOT flagged `skip_daily_sync`. Which feeds THIS backend fully
 * ingests is a separate opt-in flag, `hono_full_ingest` (see syncAwinFeeds).
 *
 * The row mapping below was derived by comparing the raw UA feed to the rows
 * the edge function actually wrote to prod. It is intentionally literal — do
 * not "improve" it without re-deriving against prod.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const UPSERT_BATCH_SIZE = 250;

export interface AwinMerchant {
  id: string;
  awin_feed_url: string | null;
  currency_code: string | null;
}

export interface AwinProductRow {
  merchant_id: string;
  product_id_in_feed: string;
  sku: string | null;
  name: string | null;
  description: string | null;
  brand: string | null;
  category: string | null;
  merchant_category: string | null;
  price: number | null;
  search_price: number | null;
  rrp_price: number | null;
  currency: string | null;
  in_stock: boolean;
  product_url: string | null;
  awin_deep_link: string | null;
  image_urls: string[];
  lifestyle_image_url: string | null;
  feed_run_id: string;
  last_seen_at: string;
  updated_at: string;
  removed_at: null;
}

export interface SyncResult {
  merchantId: string;
  count: number;
  error: string | null;
}

export interface SyncOpts {
  merchantIds?: string[];
}

function requireAdmin(): SupabaseClient {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error(
      "awin feed sync: Supabase admin unavailable (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset)"
    );
  }
  return admin;
}

/**
 * Minimal RFC4180 CSV parser: handles quoted fields, "" escaped quotes, and
 * \r\n / \n line endings. Returns an array of rows, each an array of string
 * cells. The feed is comma-delimited.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // swallow; \n (if present) finalizes the row
    } else {
      field += ch;
    }
  }

  // flush trailing field/row if the file didn't end on a newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parsePrice(value: string | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  if (cleaned === "") return null;
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

function parseStock(value: string | null | undefined): boolean {
  if (value == null || value === "") return true; // default in stock
  const v = value.trim().toLowerCase();
  if (["in stock", "instock", "true", "yes", "1"].includes(v)) return true;
  if (["out of stock", "outofstock", "false", "no", "0"].includes(v)) return false;
  return true;
}

/** Build a case-insensitive header -> column index map (first occurrence wins). */
function buildHeaderIndex(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    if (!map.has(key)) map.set(key, i);
  });
  return map;
}

/**
 * Returns the first non-empty (after trim) value among the given aliases,
 * or null when none are present/non-empty.
 */
function firstPresent(
  cells: string[],
  headerIndex: Map<string, number>,
  aliases: string[]
): string | null {
  for (const alias of aliases) {
    const idx = headerIndex.get(alias.toLowerCase());
    if (idx === undefined) continue;
    const raw = cells[idx];
    if (raw == null) continue;
    const val = raw.trim();
    if (val !== "") return val;
  }
  return null;
}

function buildImageUrls(cells: string[], headerIndex: Map<string, number>): string[] {
  const merchantImage = firstPresent(cells, headerIndex, ["merchant_image_url"]);
  const awImage = firstPresent(cells, headerIndex, ["aw_image_url"]);
  const imageLink = firstPresent(cells, headerIndex, ["image_link"]);
  const additional = firstPresent(cells, headerIndex, ["additional_image_link"]);

  const candidates: (string | null)[] = [merchantImage, awImage, imageLink];
  if (additional) {
    for (const part of additional.split(/[,|]/)) {
      const t = part.trim();
      if (t) candidates.push(t);
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (!c) continue; // falsy-filtered
    if (seen.has(c)) continue; // de-duplicated
    seen.add(c);
    out.push(c);
  }
  return out;
}

function buildProductRow(
  cells: string[],
  headerIndex: Map<string, number>,
  merchant: AwinMerchant,
  feedRunId: string,
  runTimestamp: string
): AwinProductRow | null {
  const productIdInFeed = firstPresent(cells, headerIndex, [
    "aw_product_id",
    "product_id",
    "id",
  ]);
  if (!productIdInFeed) return null; // REQUIRED — skip

  const currency =
    firstPresent(cells, headerIndex, ["currency", "currency_code"]) ??
    (merchant.currency_code ?? null);

  return {
    merchant_id: merchant.id,
    product_id_in_feed: productIdInFeed,
    sku: firstPresent(cells, headerIndex, ["merchant_product_id", "sku", "mpn"]),
    name: firstPresent(cells, headerIndex, ["product_name", "title", "name"]),
    description: firstPresent(cells, headerIndex, ["description"]),
    brand: firstPresent(cells, headerIndex, ["brand_name", "brand"]),
    category: firstPresent(cells, headerIndex, [
      "product_type",
      "google_product_category",
      "merchant_category",
    ]),
    merchant_category: firstPresent(cells, headerIndex, ["merchant_category"]),
    price: parsePrice(firstPresent(cells, headerIndex, ["price"])),
    search_price: parsePrice(
      firstPresent(cells, headerIndex, ["search_price", "sale_price"])
    ),
    rrp_price: parsePrice(firstPresent(cells, headerIndex, ["rrp_price", "rrp"])),
    currency,
    in_stock: parseStock(
      firstPresent(cells, headerIndex, ["availability", "in_stock", "is_in_stock"])
    ),
    product_url: firstPresent(cells, headerIndex, ["merchant_deep_link", "link"]),
    awin_deep_link: firstPresent(cells, headerIndex, ["aw_deep_link"]),
    image_urls: buildImageUrls(cells, headerIndex),
    lifestyle_image_url: firstPresent(cells, headerIndex, [
      "lifestyle_image_link",
      "lifestyle_image_url",
    ]),
    feed_run_id: feedRunId,
    last_seen_at: runTimestamp,
    updated_at: runTimestamp,
    removed_at: null,
  };
}

/**
 * Sync a single Awin merchant's product feed into awin_products.
 * Fetches the gzip CSV, inflates, parses, maps, de-duplicates by
 * product_id_in_feed (last wins), upserts in batches, tombstones stale rows,
 * and records status on awin_merchants. Rethrows on error after recording it.
 */
export async function syncOneAwinFeed(merchant: AwinMerchant): Promise<SyncResult> {
  const admin = requireAdmin();
  const runStart = new Date().toISOString();
  const feedRunId = crypto.randomUUID();

  try {
    if (!merchant.awin_feed_url) {
      throw new Error("fetch_or_inflate: merchant has no awin_feed_url");
    }

    const res = await fetch(merchant.awin_feed_url, {
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!res.ok) {
      throw new Error(`fetch_or_inflate: HTTP ${res.status}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const csv = zlib.gunzipSync(buf).toString("utf8");

    const parsed = parseCsv(csv);
    if (parsed.length < 2) {
      throw new Error("parse: feed had no data rows");
    }

    const header = parsed[0] ?? [];
    const headerIndex = buildHeaderIndex(header);

    // De-duplicate by product_id_in_feed keeping the LAST occurrence — a single
    // upsert batch can't affect the same conflict key twice.
    const byId = new Map<string, AwinProductRow>();
    for (let i = 1; i < parsed.length; i++) {
      const cells = parsed[i];
      if (!cells) continue;
      const row = buildProductRow(cells, headerIndex, merchant, feedRunId, runStart);
      if (!row) continue;
      byId.set(row.product_id_in_feed, row);
    }

    const rows = Array.from(byId.values());

    for (let start = 0; start < rows.length; start += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(start, start + UPSERT_BATCH_SIZE);
      const batchIndex = Math.floor(start / UPSERT_BATCH_SIZE);
      const { error } = await admin
        .from("awin_products")
        .upsert(batch, { onConflict: "merchant_id,product_id_in_feed" });
      if (error) {
        throw new Error(`upsert batch ${batchIndex}: ${error.message}`);
      }
    }

    // Tombstone rows not seen in this run.
    const tombstoneAt = new Date().toISOString();
    const { error: tombErr } = await admin
      .from("awin_products")
      .update({ removed_at: tombstoneAt })
      .eq("merchant_id", merchant.id)
      .is("removed_at", null)
      .lt("last_seen_at", runStart);
    if (tombErr) {
      throw new Error(`tombstone: ${tombErr.message}`);
    }

    const syncedAt = new Date().toISOString();
    const { error: statusErr } = await admin
      .from("awin_merchants")
      .update({
        feed_last_synced_at: syncedAt,
        feed_last_product_count: rows.length,
        feed_last_error: null,
      })
      .eq("id", merchant.id);
    if (statusErr) {
      throw new Error(`status update: ${statusErr.message}`);
    }

    return { merchantId: merchant.id, count: rows.length, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Record the failure but do not clear feed_last_product_count.
    await admin
      .from("awin_merchants")
      .update({ feed_last_error: message })
      .eq("id", merchant.id);
    throw err;
  }
}

/**
 * Determine target merchants and sync each. When opts.merchantIds is provided,
 * sync EXACTLY those; otherwise sweep every awin_merchants row flagged
 * `hono_full_ingest = true`.
 *
 * IMPORTANT: the bodyless sweep keys off `hono_full_ingest`, NOT
 * `skip_daily_sync`. Several oversized feeds (Zeagoo 88k, Punk Design, LA
 * Apparel) carry `skip_daily_sync = true` so the edge function leaves them
 * alone, but they are intentionally kept partial/deduped and must NOT be
 * fully ingested here. Only `hono_full_ingest` merchants (Under Armour) get a
 * full Hono catalog pull.
 */
export async function syncAwinFeeds(opts?: SyncOpts): Promise<SyncResult[]> {
  const admin = requireAdmin();

  let merchants: AwinMerchant[];
  if (opts?.merchantIds && opts.merchantIds.length > 0) {
    const { data, error } = await admin
      .from("awin_merchants")
      .select("id, awin_feed_url, currency_code")
      .in("id", opts.merchantIds);
    if (error) throw new Error(`load merchants: ${error.message}`);
    merchants = (data ?? []) as AwinMerchant[];
  } else {
    const { data, error } = await admin
      .from("awin_merchants")
      .select("id, awin_feed_url, currency_code")
      .eq("hono_full_ingest", true);
    if (error) throw new Error(`load merchants: ${error.message}`);
    merchants = (data ?? []) as AwinMerchant[];
  }

  const results: SyncResult[] = [];
  for (const merchant of merchants) {
    try {
      results.push(await syncOneAwinFeed(merchant));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ merchantId: merchant.id, count: 0, error: message });
    }
  }
  return results;
}
