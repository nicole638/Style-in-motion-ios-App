// cutout-item-photo — v28 (2026-07-02)
//
// v28: SWIM routes seg+ghost (same as bottoms). Ghost-direct on a swimsuit
// model shot hallucinated a whole different garment (generic blue tee) —
// the ghost AI can't find a dominant garment when the frame is mostly skin.
// The APPAREL_SEG 'swim' prompt ('swimsuit') existed since v18 but was never
// routed. Seg isolates the suit first, then Ghost reconstructs it clean.
// Fragment guard unchanged: flat catalog swim shots that seg can't edge fall
// back to plain ghost, which is safe there (garment dominates the frame).
//
// v27: BOTTOMS = SEG+GHOST with a SPECIFIC garment word ('jeans'/'shorts'/'skirt'/
// 'leggings'/'pants' from the item name) + a fragment-guard. Empirically the
// winner (viewed pixels): on a model shot, segment the named garment (isolates
// the JEANS, excluding the model's top), then Ghost-Mannequin RECONSTRUCTS it
// into a clean, complete garment — fixing both the v24 wrong-garment grab AND the
// v25/v26 seg fragmentation. Fragment guard: if the seg step returns a tiny mask
// (dark/low-contrast FLAT catalog bottoms, which seg can't edge), ghost-puffing it
// would blob — so fall back to plain Ghost on the ORIGINAL (clean on flat shots).
// Tops/dresses/outerwear unchanged (ghost-direct — their product IS the dominant garment).
//
// v26: bottoms→seg-alone + fragment-guard ghost (fixed grab, but seg fragmented good shots).
// v25: bottoms→seg-alone (fixed grab, regressed flat darks). v24: bottoms→ghost (clean, wrong garment on model shots).
// v23: per-candidate cutouts. v22: non-apparel→auto_bg. v21: Scene7 TIF. v20: Cloudinary JPEG.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PHOTOROOM_API_KEY = Deno.env.get("PHOTOROOM_API_KEY")!;
const SCRAPINGBEE_KEY = Deno.env.get("SCRAPINGBEE_API_KEY") ?? "";

const SEG_MIN_BYTES = 40000; // below this, a garment seg is a fragment → don't ghost-puff it; plain ghost instead

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FORTRESS_HOSTS: Array<{ pattern: RegExp; referer: string }> = [
  { pattern: /(^|\.)aritzia\.com$/i,                    referer: "https://www.aritzia.com/" },
  { pattern: /(^|\.)bloomingdales\.com$/i,              referer: "https://www.bloomingdales.com/" },
  { pattern: /(^|\.)macys(assets)?\.com$/i,             referer: "https://www.macys.com/" },
  { pattern: /(^|\.)nordstrom(image)?\.com$/i,          referer: "https://www.nordstrom.com/" },
  { pattern: /(^|\.)dickssportinggoods\.com$/i,         referer: "https://www.dickssportinggoods.com/" },
  { pattern: /(^|\.)ulta\.com$/i,                       referer: "https://www.ulta.com/" },
  { pattern: /(^|\.)sephora\.com$/i,                    referer: "https://www.sephora.com/" },
  { pattern: /assets\.aritzia\.com$/i,                   referer: "https://www.aritzia.com/" },
  { pattern: /images\.bloomingdales\.com$/i,             referer: "https://www.bloomingdales.com/" },
  { pattern: /images\.bloomingdalesassets\.com$/i,       referer: "https://www.bloomingdales.com/" },
  { pattern: /slimages\.macysassets\.com$/i,             referer: "https://www.macys.com/" },
  { pattern: /images\.nordstrom\.com$/i,                 referer: "https://www.nordstrom.com/" },
  { pattern: /images\.dickssportinggoods\.com$/i,        referer: "https://www.dickssportinggoods.com/" },
  { pattern: /images\.ulta\.com$/i,                      referer: "https://www.ulta.com/" },
];

function matchFortress(url: string): { referer: string } | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const f of FORTRESS_HOSTS) if (f.pattern.test(host)) return { referer: f.referer };
  } catch { /* */ }
  return null;
}

function forceCloudinaryJpeg(url: string): string {
  try {
    const u = new URL(url);
    const isCloudinaryStyle =
      u.pathname.includes("/image/upload/") &&
      !/\.(jpe?g|png|webp|avif|tiff?|gif)$/i.test(u.pathname);
    if (isCloudinaryStyle) return `${u.origin}${u.pathname}.jpg${u.search}`;
  } catch { /* */ }
  return url;
}

function forceScene7Jpeg(url: string): string {
  try {
    const u = new URL(url);
    if (/_fpx\.tif$/i.test(u.pathname) || /\.tif$/i.test(u.pathname)) {
      if (!u.searchParams.has("fmt") && !u.searchParams.has("format")) {
        u.searchParams.set("wid", "1200");
        u.searchParams.set("fmt", "jpeg");
        u.searchParams.set("qlt", "85");
        return u.toString();
      }
    }
  } catch { /* */ }
  return url;
}

function rewriteForFormat(url: string): { rewritten: string; reason: string | null } {
  const c = forceCloudinaryJpeg(url);
  const s = forceScene7Jpeg(c);
  const reason = c !== url ? "cloudinary_force_jpeg" : s !== c ? "scene7_tif_to_jpeg" : null;
  return { rewritten: s, reason };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CutoutMode = "apparel" | "footwear" | "bag" | "jewelry" | "accessory" | "auto";
type ApparelSub = "top" | "bottom" | "dress" | "outerwear" | "swim" | "generic";
type RenderPath = "ghost" | "seg" | "seg+ghost" | "auto_bg" | "auto";

const MODE_PARAMS: Record<CutoutMode, Record<string, string>> = {
  apparel: { padding: "0.05" }, footwear: { padding: "0.08" }, bag: { padding: "0.05" },
  jewelry: { padding: "0.03" }, accessory: { padding: "0.05" }, auto: { padding: "0.05" },
};

const APPAREL_SEG: Record<ApparelSub, { prompt: string; negativePrompt: string }> = {
  top: { prompt: "top", negativePrompt: "person, face, hair, hand, arm, leg, foot, pant, jean, short, skirt, mannequin, torso, dress form, dummy" },
  bottom: { prompt: "pants", negativePrompt: "person, face, hair, hand, arm, top, shirt, blouse, jacket, shoe, mannequin, torso, dress form, dummy" },
  dress: { prompt: "dress", negativePrompt: "person, face, hair, hand, arm, foot, shoe, mannequin, dress form, dummy" },
  outerwear: { prompt: "jacket", negativePrompt: "person, face, hair, hand, leg, foot, pant, shoe, mannequin, torso, dress form, dummy" },
  swim: { prompt: "swimsuit", negativePrompt: "person, face, hair, hand, arm, leg, foot, mannequin, torso, dress form, dummy" },
  generic: { prompt: "clothing", negativePrompt: "person, face, hair, hand, arm, leg, foot, mannequin, torso, dress form, dummy" },
};

// v27: specific bottom garment word from the item name — a precise prompt
// ('jeans') segments far more completely than the generic 'pants'.
function bottomWord(name: string | null): string {
  const n = (name ?? "").toLowerCase();
  if (/\b(jean|denim)s?\b/.test(n)) return "jeans";
  if (/\bshorts?\b/.test(n)) return "shorts";
  if (/\bskirts?\b/.test(n)) return "skirt";
  if (/\b(legging|capri|yoga)s?\b/.test(n)) return "leggings";
  if (/\b(jogger|sweatpant)s?\b/.test(n)) return "sweatpants";
  return "pants";
}

function isValidMode(s: unknown): s is CutoutMode {
  return typeof s === "string" && ["apparel", "footwear", "bag", "jewelry", "accessory", "auto"].includes(s);
}

function inferApparelSub(category: string | null, name: string | null): ApparelSub {
  const cat = (category ?? "").toLowerCase().trim();
  const nm = (name ?? "").toLowerCase().trim();
  const both = `${cat} ${nm}`;
  if (/\b(dress|gown|maxi|midi)s?\b/.test(both)) return "dress";
  if (/\b(jumpsuit|romper|onesie|catsuit)s?\b/.test(both)) return "dress";
  if (/\b(swim|swimsuit|bikini|leotard|maillot|bodysuit)s?\b/.test(both)) return "swim";
  if (/\b(jacket|coat|sweater|cardigan|blazer|hoodie|sweatshirt|outerwear|vest|kimono|trench|puffer|parka)s?\b/.test(both)) return "outerwear";
  if (/\b(pant|jean|short|skirt|legging|capri|trouser|chino|jogger)s?\b/.test(both)) return "bottom";
  if (/\b(top|shirt|tee|tshirt|t-shirt|blouse|tank|cami|corset|bustier|crop|halter)s?\b/.test(both)) return "top";
  if (/\b(bra|lingerie|underwear|pajama|sleepwear|loungewear)s?\b/.test(both)) return "top";
  return "generic";
}

function renderPathFor(mode: CutoutMode, sub: ApparelSub): RenderPath {
  if (mode === "auto") return "auto";
  // v27: bottoms → seg+ghost (segment the named garment, then ghost-reconstruct
  // it clean). Fragment-guard in cutSingle falls back to plain ghost on flat darks.
  // v28: swim → seg+ghost too. Ghost-direct on a swim model shot has no dominant
  // garment to lock onto (frame is mostly skin) and hallucinates a different garment.
  if (mode === "apparel") return (sub === "bottom" || sub === "swim") ? "seg+ghost" : "ghost";
  return "auto_bg";
}

function inferMode(category: string | null, name: string | null): CutoutMode {
  const cat = (category ?? "").toLowerCase().trim();
  const nm = (name ?? "").toLowerCase().trim();
  const both = `${cat} ${nm}`;
  if (/\b(shoe|boot|sandal|sneaker|heel|slipper|footwear|loafer|flat|pump|mule|clog|wedge)s?\b/.test(both)) return "footwear";
  if (/\b(bag|handbag|purse|clutch|backpack|wallet|tote|crossbody|satchel|hobo|baguette|bucket)s?\b/.test(both)) return "bag";
  if (/\b(jewel|earring|necklace|bracelet|ring|chain|pendant|cuff|anklet|brooch)s?\b/.test(both)) return "jewelry";
  if (/\b(belt|hat|cap|scarf|sunglass|eyewear|watch|tie|strap|band|glove|mitten|headband|hairband)s?\b/.test(both)) return "accessory";
  if (
    /\b(dress|gown|maxi|midi)s?\b/.test(both) ||
    /\b(top|shirt|tee|tshirt|t-shirt|blouse|tank|cami|bodysuit|corset|bustier|crop|halter)s?\b/.test(both) ||
    /\b(pant|jean|short|skirt|legging|capri|trouser|chino|jogger)s?\b/.test(both) ||
    /\b(jacket|coat|sweater|cardigan|blazer|hoodie|sweatshirt|outerwear|vest|kimono|trench|puffer|parka)s?\b/.test(both) ||
    /\b(jumpsuit|romper|swim|swimsuit|bikini|leotard|onesie|pajama|sleepwear|loungewear|lingerie|underwear|bra)s?\b/.test(both)
  ) return "apparel";
  return "auto";
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readImageResponse(res: Response): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const contentType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
  if (!contentType.startsWith("image/")) { console.warn("non_image_content", contentType); return null; }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 2048) { console.warn("image_too_small", bytes.byteLength); return null; }
  return { bytes, contentType };
}

async function fetchImageDirect(sourceUrl: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const isOurStorage = sourceUrl.includes(".supabase.co/storage/");
  let refererOrigin = "";
  try { const u = new URL(sourceUrl); refererOrigin = `${u.protocol}//${u.hostname}/`; } catch { return null; }
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "image/jpeg,image/png,image/webp,image/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (!isOurStorage && refererOrigin) headers.Referer = refererOrigin;
  let res: Response;
  try { res = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(20000), headers }); }
  catch (e) { console.warn("direct_fetch_threw", (e as Error).message); return null; }
  if (!res.ok) { console.warn("direct_fetch_rejected", res.status); return null; }
  return readImageResponse(res);
}

async function fetchImageViaScrapingBee(sourceUrl: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!SCRAPINGBEE_KEY) return null;
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_KEY, url: sourceUrl, render_js: "false",
    block_resources: "false", stealth_proxy: "true", country_code: "us",
  });
  let res: Response;
  try { res = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, { signal: AbortSignal.timeout(90000) }); }
  catch (e) { console.error("scrapingbee_threw", (e as Error).message); return null; }
  if (!res.ok) { console.error("scrapingbee_rejected", res.status); return null; }
  return readImageResponse(res);
}

async function fetchImageViaPremiumProxy(
  sourceUrl: string, referer: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!SCRAPINGBEE_KEY) return null;
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_KEY, url: sourceUrl, render_js: "false",
    block_resources: "false", premium_proxy: "true", country_code: "us",
    forward_headers_pure: "true",
  });
  let res: Response;
  try {
    res = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
      signal: AbortSignal.timeout(120000),
      headers: {
        "Spb-Referer": referer, "Spb-User-Agent": BROWSER_UA,
        "Spb-Accept": "image/jpeg,image/png,image/webp,image/*;q=0.8",
        "Spb-Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (e) { console.error("premium_proxy_threw", (e as Error).message); return null; }
  if (!res.ok) { console.error("premium_proxy_rejected", res.status); return null; }
  return readImageResponse(res);
}

async function fetchImageWithFallback(
  sourceUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string; via: string } | null> {
  const fortress = matchFortress(sourceUrl);
  let img = await fetchImageDirect(sourceUrl);
  if (img) return { ...img, via: "direct" };
  img = await fetchImageViaScrapingBee(sourceUrl);
  if (img) return { ...img, via: "scrapingbee_stealth" };
  if (fortress) {
    img = await fetchImageViaPremiumProxy(sourceUrl, fortress.referer);
    if (img) return { ...img, via: "scrapingbee_premium_proxy" };
  }
  return null;
}

async function callGhost(
  imageBytes: Uint8Array, imageContentType: string,
): Promise<{ status: number; bytes: Uint8Array; ct: string; errText?: string }> {
  const fd = new FormData();
  const ext = imageContentType.includes("png") ? "png" : imageContentType.includes("webp") ? "webp" : "jpg";
  fd.append("imageFile", new Blob([imageBytes], { type: imageContentType }), `source.${ext}`);
  fd.append("background.color", "transparent");
  fd.append("ghostMannequin.mode", "ai.auto");
  const r = await fetch("https://image-api.photoroom.com/v2/edit", {
    method: "POST", headers: { "x-api-key": PHOTOROOM_API_KEY }, body: fd,
    signal: AbortSignal.timeout(60000),
  });
  const out = new Uint8Array(await r.arrayBuffer());
  const ct = r.headers.get("content-type") ?? "image/png";
  let errText: string | undefined;
  if (r.status !== 200) errText = new TextDecoder().decode(out).slice(0, 400);
  return { status: r.status, bytes: out, ct, errText };
}

async function callAutoBg(
  imageBytes: Uint8Array, imageContentType: string, paddingPct: string,
): Promise<{ status: number; bytes: Uint8Array; ct: string; errText?: string }> {
  const fd = new FormData();
  const ext = imageContentType.includes("png") ? "png" : imageContentType.includes("webp") ? "webp" : "jpg";
  fd.append("imageFile", new Blob([imageBytes], { type: imageContentType }), `source.${ext}`);
  fd.append("background.color", "transparent");
  fd.append("padding", paddingPct);
  const r = await fetch("https://image-api.photoroom.com/v2/edit", {
    method: "POST", headers: { "x-api-key": PHOTOROOM_API_KEY }, body: fd,
    signal: AbortSignal.timeout(45000),
  });
  const out = new Uint8Array(await r.arrayBuffer());
  const ct = r.headers.get("content-type") ?? "image/png";
  let errText: string | undefined;
  if (r.status !== 200) errText = new TextDecoder().decode(out).slice(0, 400);
  return { status: r.status, bytes: out, ct, errText };
}

async function callSeg(
  imageBytes: Uint8Array, imageContentType: string, mode: CutoutMode,
  seg: { prompt: string | null; negativePrompt: string | null },
): Promise<{ status: number; bytes: Uint8Array; ct: string; errText?: string }> {
  const fd = new FormData();
  const ext = imageContentType.includes("png") ? "png" : imageContentType.includes("webp") ? "webp" : "jpg";
  fd.append("imageFile", new Blob([imageBytes], { type: imageContentType }), `source.${ext}`);
  fd.append("background.color", "transparent");
  for (const [k, v] of Object.entries(MODE_PARAMS[mode])) fd.append(k, v);
  if (seg.prompt) {
    fd.append("referenceBox", "originalImage");
    fd.append("segmentation.prompt", seg.prompt);
    if (seg.negativePrompt) fd.append("segmentation.negativePrompt", seg.negativePrompt);
  }
  const r = await fetch("https://image-api.photoroom.com/v2/edit", {
    method: "POST", headers: { "x-api-key": PHOTOROOM_API_KEY }, body: fd,
    signal: AbortSignal.timeout(45000),
  });
  const out = new Uint8Array(await r.arrayBuffer());
  const ct = r.headers.get("content-type") ?? "image/png";
  let errText: string | undefined;
  if (r.status !== 200) errText = new TextDecoder().decode(out).slice(0, 400);
  return { status: r.status, bytes: out, ct, errText };
}

async function cutSingle(
  sourceUrl: string, mode: CutoutMode, apparelSub: ApparelSub, renderPath: RenderPath,
  seg: { prompt: string | null; negativePrompt: string | null },
): Promise<{ bytes: Uint8Array; steps: string[]; via: string } | null> {
  const img = await fetchImageWithFallback(sourceUrl);
  if (!img) return null;
  const steps: string[] = [];
  try {
    if (renderPath === "ghost") {
      const r = await callGhost(img.bytes, img.contentType);
      steps.push(`ghost:${r.status}`);
      if (r.status !== 200) return null;
      return { bytes: r.bytes, steps, via: img.via };
    }
    if (renderPath === "seg+ghost") {
      // v27: segment the named garment ('jeans'), then ghost-reconstruct it clean.
      // Fragment guard: if seg returns a tiny mask (dark/low-contrast flat catalog
      // bottom), ghost-puffing it blobs → fall back to plain ghost on the original.
      const r1 = await callSeg(img.bytes, img.contentType, mode, seg);
      steps.push(`seg:${r1.status}:${r1.status === 200 ? r1.bytes.byteLength : 0}`);
      if (r1.status === 200 && r1.bytes.byteLength >= SEG_MIN_BYTES) {
        const r2 = await callGhost(r1.bytes, "image/png");
        steps.push(`ghost:${r2.status}`);
        if (r2.status === 200) return { bytes: r2.bytes, steps, via: img.via };
        return { bytes: r1.bytes, steps, via: img.via }; // ghost failed → use the clean seg
      }
      const rg = await callGhost(img.bytes, img.contentType);
      steps.push(`ghost_fallback:${rg.status}`);
      if (rg.status === 200) return { bytes: rg.bytes, steps, via: img.via };
      if (r1.status === 200) return { bytes: r1.bytes, steps, via: img.via };
      return null;
    }
    if (renderPath === "seg") {
      const r = await callSeg(img.bytes, img.contentType, mode, seg);
      steps.push(`seg:${r.status}:${r.status === 200 ? r.bytes.byteLength : 0}`);
      if (r.status === 200 && r.bytes.byteLength >= SEG_MIN_BYTES) return { bytes: r.bytes, steps, via: img.via };
      const rg = await callGhost(img.bytes, img.contentType);
      steps.push(`ghost_fallback:${rg.status}`);
      if (rg.status === 200) return { bytes: rg.bytes, steps, via: img.via };
      if (r.status === 200) return { bytes: r.bytes, steps, via: img.via };
      return null;
    }
    if (renderPath === "auto_bg") {
      const r = await callAutoBg(img.bytes, img.contentType, MODE_PARAMS[mode].padding);
      steps.push(`auto_bg:${r.status}`);
      if (r.status !== 200) return null;
      return { bytes: r.bytes, steps, via: img.via };
    }
    const rg = await callGhost(img.bytes, img.contentType);
    steps.push(`ghost:${rg.status}`);
    if (rg.status === 200) return { bytes: rg.bytes, steps, via: img.via };
    const rb = await callAutoBg(img.bytes, img.contentType, MODE_PARAMS["auto"].padding);
    steps.push(`auto_bg:${rb.status}`);
    if (rb.status !== 200) return null;
    return { bytes: rb.bytes, steps, via: img.via };
  } catch (e) {
    console.warn("cutSingle_threw", (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  let body: { item_id?: string; force?: boolean; mode?: string };
  try { body = await req.json(); } catch { return jsonRes({ error: "bad_json" }, 400); }
  const itemId = body.item_id?.trim();
  const force = body.force === true;
  const explicitMode = isValidMode(body.mode) ? body.mode : null;
  if (!itemId) return jsonRes({ error: "missing_item_id" }, 400);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: item, error: loadErr } = await supa.from("creator_items")
    .select("id, creator_id, name, category, photo_url, cutout_photo_url, original_photo_url, candidate_photo_urls")
    .eq("id", itemId).maybeSingle();
  if (loadErr) return jsonRes({ error: "db_load_failed", detail: loadErr.message }, 500);
  if (!item) return jsonRes({ error: "item_not_found" }, 404);

  const mode: CutoutMode = explicitMode ?? inferMode(item.category as string | null, item.name as string | null);
  const apparelSub: ApparelSub = mode === "apparel" ? inferApparelSub(item.category as string | null, item.name as string | null) : "generic";
  const renderPath = renderPathFor(mode, apparelSub);

  let seg: { prompt: string | null; negativePrompt: string | null } = { prompt: null, negativePrompt: null };
  if ((renderPath === "seg+ghost" || renderPath === "seg") && mode === "apparel") {
    const base = APPAREL_SEG[apparelSub];
    const prompt = apparelSub === "bottom" ? bottomWord(item.name as string | null) : base.prompt;
    seg = { prompt, negativePrompt: base.negativePrompt };
  }

  const rawSourceUrl = (item.original_photo_url ?? item.photo_url ?? "").trim();
  if (!rawSourceUrl) return jsonRes({ error: "no_source_photo" }, 400);

  const { rewritten: sourceUrl, reason: rewriteReason } = rewriteForFormat(rawSourceUrl);
  const sourceRewritten = sourceUrl !== rawSourceUrl;

  const sourceHash = await sha256Hex(
    `${sourceUrl}::${mode}::${apparelSub}::${renderPath}::${seg.prompt ?? "none"}::${seg.negativePrompt ?? "none"}`
  );

  if (!force && item.cutout_photo_url) {
    if (item.cutout_photo_url.includes(sourceHash.slice(0, 16))) {
      return jsonRes({
        ok: true, skipped: true, cutout_url: item.cutout_photo_url, mode,
        render_path: renderPath, apparel_sub: apparelSub,
        reason: "already_cut_from_same_source_mode_and_path",
      });
    }
  }

  const primary = await cutSingle(sourceUrl, mode, apparelSub, renderPath, seg);
  if (!primary) {
    return jsonRes({
      error: "primary_cut_failed",
      detail: "Image fetch or Photoroom call failed for the primary photo.",
      source_url: sourceUrl, source_rewritten: sourceRewritten,
    }, 502);
  }

  const primaryPath = `cutouts/${item.creator_id}/${itemId}-${sourceHash.slice(0, 16)}.png`;
  const { error: upErr } = await supa.storage.from("item-photos")
    .upload(primaryPath, primary.bytes, { contentType: "image/png", upsert: true, cacheControl: "3600" });
  if (upErr) return jsonRes({ error: "upload_failed", detail: upErr.message }, 500);
  const primaryCutoutUrl = `${SUPABASE_URL}/storage/v1/object/public/item-photos/${primaryPath}`;

  const candidates: string[] = Array.isArray(item.candidate_photo_urls)
    ? (item.candidate_photo_urls as string[]).filter((u) => typeof u === "string" && u.length > 0)
    : [];
  const candidateCutoutUrls: (string | null)[] = [];
  const candidateStats: Array<{ index: number; ok: boolean; reused?: boolean; steps?: string[]; via?: string }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const candUrl = candidates[i];
    const { rewritten: candRewritten } = rewriteForFormat(candUrl);
    if (candRewritten === sourceUrl || candUrl === rawSourceUrl) {
      candidateCutoutUrls.push(primaryCutoutUrl);
      candidateStats.push({ index: i, ok: true, reused: true });
      continue;
    }
    const candHash = await sha256Hex(
      `${candRewritten}::${mode}::${apparelSub}::${renderPath}::${seg.prompt ?? "none"}::${seg.negativePrompt ?? "none"}`
    );
    const candCut = await cutSingle(candRewritten, mode, apparelSub, renderPath, seg);
    if (!candCut) {
      candidateCutoutUrls.push(null);
      candidateStats.push({ index: i, ok: false });
      continue;
    }
    const candPath = `cutouts/${item.creator_id}/${itemId}-c${i}-${candHash.slice(0, 16)}.png`;
    const { error: candUpErr } = await supa.storage.from("item-photos")
      .upload(candPath, candCut.bytes, { contentType: "image/png", upsert: true, cacheControl: "3600" });
    if (candUpErr) {
      console.warn("candidate_upload_failed", i, candUpErr.message);
      candidateCutoutUrls.push(null);
      candidateStats.push({ index: i, ok: false });
      continue;
    }
    candidateCutoutUrls.push(`${SUPABASE_URL}/storage/v1/object/public/item-photos/${candPath}`);
    candidateStats.push({ index: i, ok: true, steps: candCut.steps, via: candCut.via });
  }

  const updates: Record<string, unknown> = {
    photo_url: primaryCutoutUrl,
    cutout_photo_url: primaryCutoutUrl,
    candidate_cutout_urls: candidateCutoutUrls,
  };
  if (!item.original_photo_url) updates.original_photo_url = rawSourceUrl;

  const { error: writeErr } = await supa.from("creator_items").update(updates).eq("id", itemId);
  if (writeErr) return jsonRes({ error: "db_update_failed", detail: writeErr.message }, 500);

  return jsonRes({
    ok: true, cutout_url: primaryCutoutUrl, mode, render_path: renderPath, apparel_sub: apparelSub,
    segmentation_prompt: seg.prompt, segmentation_negative_prompt: seg.negativePrompt,
    steps: primary.steps, skipped: false,
    fetched_via: primary.via,
    source_rewritten: sourceRewritten,
    source_rewrite_reason: rewriteReason,
    candidate_count: candidates.length,
    candidate_cuts_succeeded: candidateStats.filter((s) => s.ok).length,
    candidate_stats: candidateStats,
  });
});
