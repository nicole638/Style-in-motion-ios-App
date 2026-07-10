// cutout-all-candidates v1 — Photoroom cutouts for every candidate photo on
// a creator_items row, not just the primary. Unlocks collage variety:
// creators can now use back/side/lifestyle shots as transparent cutouts.
//
// Reuses the proven fetch pattern from cutout-item-photo (direct fetch with
// browser UA → ScrapingBee stealth fallback for hot-link-locked CDNs).
//
// Cost control:
//   - Hard cap at MAX_CANDIDATES (default 4) per item
//   - Skip indices that already have cutouts (idempotent)
//   - If primary already has cutout_photo_url, reuse it at index 0
//
// INPUT:  { item_id: uuid, force?: boolean, max?: int (default 4) }
// OUTPUT: { ok, processed, cutout_urls, skipped, errors }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PHOTOROOM_API_KEY = Deno.env.get("PHOTOROOM_API_KEY")!;
const SCRAPINGBEE_KEY = Deno.env.get("SCRAPINGBEE_API_KEY") ?? "";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_MAX_CANDIDATES = 4;

const MODE_PARAMS: Record<string, Record<string, string>> = {
  apparel: { padding: "0.05" },
  footwear: { padding: "0.08" },
  bag: { padding: "0.05" },
  jewelry: { padding: "0.03" },
  accessory: { padding: "0.05" },
  auto: { padding: "0.05" },
};

function categoryToMode(category: string | null): string {
  if (!category) return "auto";
  const c = category.toLowerCase().trim();
  if (/dress|top|shirt|tee|pant|jean|short|skirt|jacket|coat|sweater|cardigan|blazer|jumpsuit|romper|swim|legging|outerwear|hoodie|sweatshirt|tank|blouse|bodysuit|pajama|sleepwear|loungewear|lingerie|underwear|vest/.test(c)) return "apparel";
  if (/shoe|boot|sandal|sneaker|heel|slipper|footwear|loafer|flat/.test(c)) return "footwear";
  if (/bag|handbag|purse|clutch|backpack|wallet|tote|crossbody|satchel/.test(c)) return "bag";
  if (/jewel|earring|necklace|bracelet|ring|chain|pendant|cuff/.test(c)) return "jewelry";
  if (/accessor|belt|hat|cap|scarf|sunglass|eyewear|watch|tie/.test(c)) return "accessory";
  return "auto";
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fetchImageDirect(url: string): Promise<{ bytes: Uint8Array; ct: string } | null> {
  const isOurStorage = url.includes(".supabase.co/storage/");
  let referer = "";
  try {
    const u = new URL(url);
    referer = `${u.protocol}//${u.hostname}/`;
  } catch { return null; }
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  };
  if (!isOurStorage && referer) headers.Referer = referer;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers });
    if (!res.ok) return null;
    return readImage(res);
  } catch { return null; }
}

async function fetchImageViaScrapingBee(url: string): Promise<{ bytes: Uint8Array; ct: string } | null> {
  if (!SCRAPINGBEE_KEY) return null;
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_KEY, url, render_js: "false",
    block_resources: "false", stealth_proxy: "true", country_code: "us",
  });
  try {
    const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) return null;
    return readImage(res);
  } catch { return null; }
}

async function readImage(res: Response): Promise<{ bytes: Uint8Array; ct: string } | null> {
  const ct = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
  if (!ct.startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 2048) return null;
  return { bytes, ct };
}

async function callPhotoroom(bytes: Uint8Array, ct: string, mode: string): Promise<{ ok: boolean; bytes?: Uint8Array; err?: string }> {
  const fd = new FormData();
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  fd.append("imageFile", new Blob([bytes], { type: ct }), `source.${ext}`);
  fd.append("background.color", "transparent");
  for (const [k, v] of Object.entries(MODE_PARAMS[mode] ?? MODE_PARAMS.auto)) fd.append(k, v);
  try {
    const r = await fetch("https://image-api.photoroom.com/v2/edit", {
      method: "POST",
      headers: { "x-api-key": PHOTOROOM_API_KEY },
      body: fd,
      signal: AbortSignal.timeout(45000),
    });
    if (r.status !== 200) {
      const errText = new TextDecoder().decode(new Uint8Array(await r.arrayBuffer())).slice(0, 200);
      return { ok: false, err: `photoroom_${r.status}: ${errText}` };
    }
    return { ok: true, bytes: new Uint8Array(await r.arrayBuffer()) };
  } catch (e) {
    return { ok: false, err: `photoroom_threw: ${(e as Error).message}` };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  let body: { item_id?: string; force?: boolean; max?: number };
  try { body = await req.json(); } catch { return jsonRes({ error: "bad_json" }, 400); }

  const itemId = body.item_id?.trim();
  const force = body.force === true;
  const maxCount = Math.min(Math.max(body.max ?? DEFAULT_MAX_CANDIDATES, 1), 6);
  if (!itemId) return jsonRes({ error: "missing_item_id" }, 400);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: item, error: loadErr } = await supa
    .from("creator_items")
    .select("id, creator_id, category, candidate_photo_urls, candidate_cutout_urls, cutout_photo_url")
    .eq("id", itemId)
    .maybeSingle();

  if (loadErr) return jsonRes({ error: "db_load", detail: loadErr.message }, 500);
  if (!item) return jsonRes({ error: "item_not_found" }, 404);

  const candidates: string[] = (item.candidate_photo_urls ?? []).slice(0, maxCount);
  if (candidates.length === 0) return jsonRes({ ok: true, processed: 0, cutout_urls: [], skipped: 0, errors: [], note: "no_candidates" });

  const existing: (string | null)[] = (item.candidate_cutout_urls ?? []);
  const mode = categoryToMode(item.category as string | null);

  const results: (string | null)[] = new Array(candidates.length).fill(null);
  let processed = 0, skipped = 0;
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const src = candidates[i];
    if (!src) continue;

    // Reuse the primary cutout for index 0 when source matches
    if (i === 0 && !force && item.cutout_photo_url) {
      results[0] = item.cutout_photo_url;
      skipped++;
      continue;
    }

    if (!force && existing[i]) {
      results[i] = existing[i];
      skipped++;
      continue;
    }

    let img = await fetchImageDirect(src);
    if (!img) img = await fetchImageViaScrapingBee(src);
    if (!img) {
      errors.push({ index: i, error: "image_fetch_failed" });
      results[i] = existing[i] ?? null;
      continue;
    }

    const pr = await callPhotoroom(img.bytes, img.ct, mode);
    if (!pr.ok || !pr.bytes) {
      errors.push({ index: i, error: pr.err ?? "photoroom_no_bytes" });
      results[i] = existing[i] ?? null;
      continue;
    }

    const hash = (await sha256Hex(`${src}::${mode}`)).slice(0, 16);
    const path = `cutouts/${item.creator_id}/${itemId}-c${i}-${hash}.png`;
    const { error: upErr } = await supa.storage
      .from("item-photos")
      .upload(path, pr.bytes, { contentType: "image/png", upsert: true, cacheControl: "3600" });
    if (upErr) {
      errors.push({ index: i, error: `upload: ${upErr.message}` });
      results[i] = existing[i] ?? null;
      continue;
    }
    results[i] = `${SUPABASE_URL}/storage/v1/object/public/item-photos/${path}`;
    processed++;
  }

  const { error: writeErr } = await supa
    .from("creator_items")
    .update({ candidate_cutout_urls: results })
    .eq("id", itemId);
  if (writeErr) return jsonRes({ error: "db_update", detail: writeErr.message }, 500);

  return jsonRes({ ok: true, processed, skipped, errors, cutout_urls: results });
});
