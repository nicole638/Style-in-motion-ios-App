// awin-feeds-sync v19 — backpressured streaming gunzip + variant dedupe + product cap.
//
// v19: the v17/v18 node bridge (Readable.fromWeb → createGunzip) decompressed the
// whole feed into memory ahead of our (upsert-throttled) consumer, so giant feeds
// hit WORKER_RESOURCE_LIMIT. v19 drives gunzip with a MANUAL pump that only writes
// more compressed bytes when gunzip can accept them (awaits 'drain'), so the
// decompressed buffer stays bounded and memory is flat regardless of feed size.
// Multi-member gzip still handled by node:zlib. dedup_variants + product_cap (v18)
// bound row count/time for variant-heavy giants.
//
// v14: dedupe refresh as a standard part of every sync.
// v13: detect gzip from /compression/gzip/ in URL path.  v12: brand exclusion.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createGunzip } from "node:zlib";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const MAX_IMAGES_PER_PRODUCT = 6;
const BATCH_SIZE = 250;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" }});
}

function looksGzippedByUrl(url: string): boolean {
  if (/\.gz(\?|$)/.test(url)) return true;
  if (/\/compression\/gzip(\/|$)/i.test(url)) return true;
  if (/[?&]compression=gzip(&|$)/i.test(url)) return true;
  return false;
}

function groupKeyOf(name: string): string {
  if (!name) return "";
  return name.replace(/\s[-–—]\s[^\/]+\/[^\/]+$/, "").trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  let body: { merchant_id?: string; feed_url?: string; skip_refresh?: boolean } = {};
  try { body = await req.json(); } catch { /* */ }
  if (!body.merchant_id) return jsonRes({ ok: false, error: "missing_merchant_id" }, 400);

  const skipRefresh = body.skip_refresh === true;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: merchant, error: mErr } = await supa.from("awin_merchants")
    .select("id, awinmid, merchant_name, awin_feed_url, excluded_brands, dedup_variants, product_cap")
    .eq("id", body.merchant_id)
    .eq("status", "active").is("archived_at", null).maybeSingle();
  if (mErr) return jsonRes({ error: "load_merchant_failed", detail: mErr.message }, 500);
  if (!merchant) return jsonRes({ ok: false, error: "merchant_not_found_or_inactive" }, 404);

  const excludedBrands = new Set<string>(
    (Array.isArray(merchant.excluded_brands) ? merchant.excluded_brands : [])
      .map((b: any) => String(b ?? "").trim().toLowerCase())
      .filter((b) => b.length > 0),
  );
  const dedupVariants = merchant.dedup_variants === true;
  const productCap = (typeof merchant.product_cap === "number" && merchant.product_cap > 0) ? merchant.product_cap : null;

  const feedUrl = body.feed_url ?? merchant.awin_feed_url;
  if (!feedUrl) {
    await supa.from("awin_merchants").update({ feed_last_error: "no_feed_url_set" }).eq("id", merchant.id);
    return jsonRes({ ok: false, error: "no_feed_url", merchant: merchant.merchant_name });
  }

  const startedAt = new Date();
  const { data: run } = await supa.from("awin_feed_runs").insert({
    merchant_id: merchant.id, feed_url: feedUrl, started_at: startedAt.toISOString(),
  }).select("id").single();
  const runId: string | null = run?.id ?? null;

  let httpStatus = 0;
  let totalBytes = 0;
  let totalRowsParsed = 0;
  let productsSeen = 0;
  let lifestyleSeen = 0;
  let excludedSeen = 0;
  let variantDeduped = 0;
  let capReached = false;
  let streamError: string | null = null;
  let header: string[] | null = null;
  let colIdx: Record<string, number> | null = null;
  const seenProductIds = new Set<string>();
  const variantGroups = new Set<string>();
  let productBatch: any[] = [];
  let textBuffer = "";

  const decoder = new TextDecoder("utf-8");

  const flush = async (): Promise<string | null> => {
    if (productBatch.length === 0) return null;
    const { error } = await supa.from("awin_products")
      .upsert(productBatch, { onConflict: "merchant_id,product_id_in_feed" });
    if (error) return `upsert: ${error.message.slice(0, 200)}`;
    productsSeen += productBatch.length;
    productBatch = [];
    await new Promise((r) => setTimeout(r, 0));
    return null;
  };

  const processLine = async (line: string): Promise<string | null> => {
    if (line.length === 0) return null;
    const fields = parseCsvLine(line);
    if (!header) {
      if (fields[0]) fields[0] = fields[0].replace(/^﻿/, "");
      header = fields.map((c) => c.toLowerCase().trim());
      colIdx = buildColIdx(header);
      if (colIdx.product_id < 0) return `bad_header_no_product_id: ${header.slice(0, 8).join(",")}`;
      return null;
    }
    totalRowsParsed++;
    const pid = (fields[colIdx!.product_id] ?? "").trim();
    if (!pid || seenProductIds.has(pid)) return null;
    seenProductIds.add(pid);

    if (excludedBrands.size > 0 && colIdx!.brand >= 0) {
      const rawBrand = (fields[colIdx!.brand] ?? "").trim().toLowerCase();
      if (rawBrand && excludedBrands.has(rawBrand)) { excludedSeen++; return null; }
    }

    if (dedupVariants) {
      const nm = colIdx!.name >= 0 ? (fields[colIdx!.name] ?? "") : "";
      const gk = groupKeyOf(nm);
      if (gk) { if (variantGroups.has(gk)) { variantDeduped++; return null; } variantGroups.add(gk); }
    }

    const row = buildProductRow(fields, colIdx!, merchant.id, pid, runId);
    if (row.lifestyle_image_url) lifestyleSeen++;
    productBatch.push(row);
    if (productBatch.length >= BATCH_SIZE) { const e = await flush(); if (e) return e; }
    if (productCap && (productsSeen + productBatch.length) >= productCap) {
      const e2 = await flush(); if (e2) return e2;
      capReached = true;
    }
    return null;
  };

  const drainBuffer = async (isFinal: boolean): Promise<void> => {
    let nlIdx: number;
    while ((nlIdx = textBuffer.indexOf("\n")) >= 0) {
      let line = textBuffer.slice(0, nlIdx);
      textBuffer = textBuffer.slice(nlIdx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const err = await processLine(line);
      if (err) { streamError = err; return; }
      if (capReached) return;
    }
    if (isFinal && !streamError && !capReached && textBuffer.length > 0) {
      if (textBuffer.endsWith("\r")) textBuffer = textBuffer.slice(0, -1);
      const err = await processLine(textBuffer);
      if (err) streamError = err;
      textBuffer = "";
    }
  };

  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/csv, application/gzip, */*" },
      redirect: "follow", signal: AbortSignal.timeout(90000),
    });
    httpStatus = res.status;
    if (!res.ok || !res.body) {
      streamError = `http_${res.status}`;
    } else {
      const ce = (res.headers.get("content-encoding") ?? "").toLowerCase();
      const wireDecompressed = ce.includes("gzip");
      const isGzip = !wireDecompressed && looksGzippedByUrl(feedUrl);
      if (isGzip) {
        const gunzip = createGunzip();
        gunzip.on("error", (e: Error) => { if (!streamError) streamError = `gunzip: ${e.message.slice(0, 160)}`; });
        const reader = res.body.getReader();
        const pump = (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) { gunzip.end(); break; }
              totalBytes += value.byteLength;
              if (!gunzip.write(value)) {
                await new Promise<void>((resolve) => {
                  const fin = () => { gunzip.off("drain", fin); gunzip.off("error", fin); gunzip.off("close", fin); resolve(); };
                  gunzip.once("drain", fin); gunzip.once("error", fin); gunzip.once("close", fin);
                });
              }
              if (streamError || capReached) { try { gunzip.end(); } catch { /* */ } break; }
            }
          } catch (e) {
            if (!streamError) streamError = `pump: ${(e as Error).message.slice(0, 160)}`;
          }
        })();
        for await (const chunk of gunzip) {
          totalBytes += 0;
          textBuffer += decoder.decode(chunk as Uint8Array, { stream: true });
          await drainBuffer(false);
          if (streamError || capReached) break;
        }
        try { gunzip.destroy(); } catch { /* */ }
        try { await reader.cancel(); } catch { /* */ }
        try { await pump; } catch { /* */ }
        if (!streamError && !capReached) {
          textBuffer += decoder.decode();
          await drainBuffer(true);
        }
      } else {
        const reader = res.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          textBuffer += decoder.decode(value, { stream: true });
          await drainBuffer(false);
          if (streamError || capReached) break;
        }
        try { await reader.cancel(); } catch { /* */ }
        if (!streamError && !capReached) {
          textBuffer += decoder.decode();
          await drainBuffer(true);
        }
      }
    }
  } catch (e) {
    if (!streamError) streamError = `fetch_or_inflate: ${(e as Error).message.slice(0, 200)}`;
  }

  if (productBatch.length > 0 && !streamError) {
    const err = await flush();
    if (err) streamError = err;
  }

  let tombstoned = 0;
  if (productsSeen > 0 && !streamError) {
    const { count } = await supa.from("awin_products")
      .update({ removed_at: new Date().toISOString() }, { count: "exact" })
      .eq("merchant_id", merchant.id).is("removed_at", null)
      .lt("last_seen_at", startedAt.toISOString());
    tombstoned = count ?? 0;
  }

  if (runId) {
    await supa.from("awin_feed_runs").update({
      completed_at: new Date().toISOString(),
      bytes_downloaded: totalBytes, http_status: httpStatus,
      products_seen: productsSeen, products_updated: productsSeen,
      products_tombstoned: tombstoned, error_message: streamError,
    }).eq("id", runId);
  }
  await supa.from("awin_merchants").update({
    feed_last_synced_at: new Date().toISOString(),
    feed_last_product_count: productsSeen, feed_last_error: streamError,
  }).eq("id", merchant.id);

  let refreshed = false;
  let refreshError: string | null = null;
  if (!streamError && productsSeen > 0 && !skipRefresh) {
    try {
      const { error } = await supa.rpc("refresh_affiliate_products");
      if (error) refreshError = error.message.slice(0, 200);
      else refreshed = true;
    } catch (e) { refreshError = (e as Error).message.slice(0, 200); }
  }

  return jsonRes({
    ok: !streamError, error: streamError,
    merchant_name: merchant.merchant_name, awinmid: merchant.awinmid,
    bytes_downloaded: totalBytes, total_rows_parsed: totalRowsParsed,
    products_seen: productsSeen, lifestyle_image_count: lifestyleSeen,
    excluded_by_brand: excludedSeen, variant_deduped: variantDeduped,
    cap_reached: capReached, tombstoned,
    affiliate_products_refreshed: refreshed, refresh_error: refreshError,
    refresh_skipped_by_caller: skipRefresh,
  });
});

function buildColIdx(h: string[]): Record<string, number> {
  const idxOf = (names: string[]): number => {
    for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  return {
    advertiser_id: idxOf(["advertiser_id", "merchant_id"]),
    product_id: idxOf(["id", "product_id", "aw_product_id"]),
    sku: idxOf(["mpn", "merchant_product_id", "sku"]),
    name: idxOf(["title", "product_name", "name"]),
    description: idxOf(["description"]),
    brand: idxOf(["brand", "brand_name"]),
    category: idxOf(["product_type", "google_product_category", "merchant_category"]),
    price: idxOf(["price", "store_price"]),
    sale_price: idxOf(["sale_price", "search_price"]),
    currency: idxOf(["currency"]),
    product_url: idxOf(["link", "merchant_deep_link", "product_url"]),
    aw_deep_link: idxOf(["aw_deep_link"]),
    image_url: idxOf(["image_link", "merchant_image_url"]),
    additional_images: idxOf(["additional_image_link", "aw_image_url"]),
    lifestyle_image: idxOf(["lifestyle_image_link"]),
    availability: idxOf(["availability", "in_stock"]),
  };
}
function buildProductRow(r: string[], C: Record<string, number>, merchantId: string, pid: string, feedRunId: string | null): any {
  const { amount: price, currency: pc } = parsePrice(r[C.price]);
  const { amount: salePrice } = C.sale_price >= 0 ? parsePrice(r[C.sale_price]) : { amount: null };
  const availRaw = C.availability >= 0 ? (r[C.availability] ?? "").toLowerCase() : "";
  const inStock = !availRaw || /^(in[_ ]?stock|available|1|true|yes)$/.test(availRaw);
  const primary = C.image_url >= 0 ? (r[C.image_url] ?? "").trim() : "";
  const addl = C.additional_images >= 0 ? (r[C.additional_images] ?? "").trim() : "";
  const lifestyle = C.lifestyle_image >= 0 ? (r[C.lifestyle_image] ?? "").trim() : "";
  const imgs: string[] = [];
  if (primary) imgs.push(primary);
  if (addl) for (const u of addl.split(/[,|]\s*/)) { const t = u.trim(); if (t && !imgs.includes(t)) { imgs.push(t); if (imgs.length >= MAX_IMAGES_PER_PRODUCT) break; } }
  return {
    merchant_id: merchantId, product_id_in_feed: pid,
    sku: C.sku >= 0 ? (r[C.sku] || null) : null,
    name: C.name >= 0 ? (r[C.name] || null)?.slice(0, 500) : null,
    description: C.description >= 0 ? (r[C.description] || null)?.slice(0, 2000) : null,
    brand: C.brand >= 0 ? (r[C.brand] || null)?.slice(0, 200) : null,
    category: C.category >= 0 ? (r[C.category] || null)?.slice(0, 200) : null,
    merchant_category: C.category >= 0 ? (r[C.category] || null)?.slice(0, 200) : null,
    price, search_price: salePrice ?? price, rrp_price: null,
    currency: C.currency >= 0 ? (r[C.currency] || pc || "USD") : (pc || "USD"),
    in_stock: inStock,
    product_url: C.product_url >= 0 ? (r[C.product_url] || null) : null,
    awin_deep_link: C.aw_deep_link >= 0 ? (r[C.aw_deep_link] || null) : null,
    image_urls: imgs.slice(0, MAX_IMAGES_PER_PRODUCT),
    lifestyle_image_url: lifestyle || null,
    feed_run_id: feedRunId,
    last_seen_at: new Date().toISOString(), removed_at: null, updated_at: new Date().toISOString(),
  };
}
function parsePrice(v: unknown): { amount: number | null; currency: string | null } {
  if (v === null || v === undefined) return { amount: null, currency: null };
  const s = String(v).trim(); if (!s) return { amount: null, currency: null };
  const m = s.match(/^([\d.,]+)\s*([A-Z]{3})?$/i); if (!m) return { amount: null, currency: null };
  const n = Number.parseFloat(m[1].replace(/,/g, ""));
  return { amount: Number.isFinite(n) ? n : null, currency: m[2] ? m[2].toUpperCase() : null };
}
function parseCsvLine(line: string): string[] {
  const out: string[] = []; let field = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (i + 1 < line.length && line[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else { if (ch === '"') inQ = true; else if (ch === ",") { out.push(field); field = ""; } else field += ch; }
  }
  out.push(field); return out;
}
