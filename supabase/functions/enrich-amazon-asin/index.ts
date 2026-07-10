// enrich-amazon-asin — fetches product metadata for Amazon ASINs and writes
// it to amazon_product_cache.
//
// v21 (price tier): now also captures CURRENT PRICE — from PA-API
//   Offers.Listings.Price when creds are present, else parsed from the Bright
//   Data /dp HTML we already fetch (a-offscreen / priceblock / a-price-whole).
//   Purely additive: title/image behaviour is unchanged; price is best-effort
//   and null when unresolved. New cache columns: price, currency, price_updated_at.
//
// v16 (Bright Data tier): inserts a Bright Data Web Unlocker fetch of the
//   /dp/<ASIN> page (parse productTitle + main image) BETWEEN PA-API and
//   Microlink. Order: PA-API (if creds) → Bright Data (if key) → Microlink.
//
// INPUT:  { asins: string[] }  — up to 10 ASINs per call.
// OUTPUT: { ok, enriched, failed, via: { paapi, brightdata, microlink } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ACCESS_KEY = Deno.env.get("AMAZON_PA_API_ACCESS_KEY") ?? "";
const SECRET_KEY = Deno.env.get("AMAZON_PA_API_SECRET_KEY") ?? "";
const PARTNER_TAG =
  Deno.env.get("AMAZON_PA_API_PARTNER_TAG") ?? "styledinmotio-20";

const HAS_PAAPI = Boolean(ACCESS_KEY && SECRET_KEY);

const BRIGHTDATA_API_KEY = Deno.env.get("BRIGHTDATA_API_KEY") ?? "";
const BRIGHTDATA_UNLOCKER_ZONE = Deno.env.get("BRIGHTDATA_UNLOCKER_ZONE") ?? "cli_unlocker";
const HAS_BRIGHTDATA = Boolean(BRIGHTDATA_API_KEY);

const HOST = "webservices.amazon.com";
const REGION = "us-east-1";
const SERVICE = "ProductAdvertisingAPI";
const TARGET = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems";

const ASIN_RE = /^B[0-9A-Z]{9}$/;

interface EnrichedFields {
  title: string | null;
  imageUrl: string | null;
  detailPageUrl: string | null;
  price: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  let body: { asins?: string[] };
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_json" }, 400);
  }

  const asinsRaw = Array.isArray(body.asins) ? body.asins : [];
  const asins = Array.from(
    new Set(
      asinsRaw
        .map((a) => String(a ?? "").trim().toUpperCase())
        .filter((a) => ASIN_RE.test(a)),
    ),
  );

  if (asins.length === 0) {
    return jsonRes({ error: "no_valid_asins" }, 400);
  }
  if (asins.length > 10) {
    return jsonRes(
      { error: "too_many", message: "Cap is 10 ASINs per request." },
      400,
    );
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  await supa
    .from("amazon_product_cache")
    .upsert(
      asins.map((asin) => ({ asin, fetch_status: "pending" })),
      { onConflict: "asin" },
    );

  const resolved = new Map<string, EnrichedFields>();
  let viaPaApi = 0;
  let viaBrightData = 0;
  let viaMicrolink = 0;
  let paApiError: string | null = null;

  // ── 1. PA-API (if creds present) ────────────────────
  if (HAS_PAAPI) {
    try {
      const result = await callPaApiGetItems(asins);
      for (const item of result.ItemsResult?.Items ?? []) {
        const asin = item.ASIN;
        if (!asin) continue;
        const title = item.ItemInfo?.Title?.DisplayValue ?? null;
        const imageUrl =
          item.Images?.Primary?.Large?.URL ??
          item.Images?.Primary?.Medium?.URL ??
          null;
        const price =
          (typeof item.Offers?.Listings?.[0]?.Price?.Amount === "number"
            ? item.Offers!.Listings![0].Price!.Amount!
            : null);
        resolved.set(asin, {
          title,
          imageUrl,
          detailPageUrl: item.DetailPageURL ?? null,
          price,
        });
        viaPaApi++;
      }
    } catch (e) {
      paApiError = (e as Error).message ?? String(e);
      console.warn("[enrich-amazon-asin] paapi_failed, falling back", {
        err: paApiError,
      });
    }
  }

  // ── 2. Bright Data Web Unlocker ── for anything PA-API didn't resolve ──
  if (HAS_BRIGHTDATA) {
    const missing = asins.filter((a) => !resolved.has(a));
    if (missing.length > 0) {
      const settled = await Promise.allSettled(
        missing.map((asin) => callBrightData(asin)),
      );
      settled.forEach((res, i) => {
        const asin = missing[i];
        if (res.status === "fulfilled" && res.value) {
          resolved.set(asin, res.value);
          viaBrightData++;
        }
      });
    }
  }

  // ── 3. Microlink ── last resort for anything still missing ───────────
  const stillMissing = asins.filter((a) => !resolved.has(a));
  if (stillMissing.length > 0) {
    const settled = await Promise.allSettled(
      stillMissing.map((asin) => callMicrolink(asin)),
    );
    settled.forEach((res, i) => {
      const asin = stillMissing[i];
      if (res.status === "fulfilled" && res.value) {
        resolved.set(asin, res.value);
        viaMicrolink++;
      }
    });
  }

  // ── Build enriched rows + failure list ──────────────
  const enrichedRows: Array<{
    asin: string;
    title: string | null;
    image_url: string | null;
    detail_page_url: string | null;
    price: number | null;
    price_updated_at: string | null;
    last_fetched_at: string;
    fetch_status: "complete" | "failed";
    fetch_error: string | null;
  }> = [];
  const failed: string[] = [];
  const nowIso = new Date().toISOString();

  for (const asin of asins) {
    const got = resolved.get(asin);
    if (got) {
      enrichedRows.push({
        asin,
        title: got.title,
        image_url: got.imageUrl,
        detail_page_url: got.detailPageUrl,
        price: got.price ?? null,
        price_updated_at: got.price != null ? nowIso : null,
        last_fetched_at: nowIso,
        fetch_status: "complete",
        fetch_error: null,
      });
    } else {
      failed.push(asin);
      enrichedRows.push({
        asin,
        title: null,
        image_url: null,
        detail_page_url: null,
        price: null,
        price_updated_at: null,
        last_fetched_at: nowIso,
        fetch_status: "failed",
        fetch_error:
          (paApiError ? `paapi: ${paApiError}; ` : "") +
          (HAS_BRIGHTDATA ? "brightdata+microlink: no data" : "microlink: no data"),
      });
    }
  }

  if (enrichedRows.length > 0) {
    const { error: dbErr } = await supa
      .from("amazon_product_cache")
      .upsert(enrichedRows, { onConflict: "asin" });
    if (dbErr) {
      console.error("[enrich-amazon-asin] db_upsert_failed", { err: dbErr.message });
      return jsonRes({ error: "db_upsert_failed", detail: dbErr.message }, 500);
    }
  }

  return jsonRes({
    ok: true,
    enriched: resolved.size,
    failed,
    via: { paapi: viaPaApi, brightdata: viaBrightData, microlink: viaMicrolink },
  });
});

// ────────────────────────────────────────────────
// Bright Data Web Unlocker — fetch the /dp page + parse title + image + price.
// ────────────────────────────────────────────────
async function callBrightData(asin: string): Promise<EnrichedFields | null> {
  const productUrl = `https://www.amazon.com/dp/${asin}`;
  try {
    const res = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BRIGHTDATA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zone: BRIGHTDATA_UNLOCKER_ZONE,
        url: productUrl,
        format: "raw",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn("[enrich-amazon-asin] brightdata_non_2xx", { asin, status: res.status });
      return null;
    }
    const html = await res.text();
    const title = parseAmazonTitle(html);
    const imageUrl = parseAmazonImage(html);
    const price = parseAmazonPrice(html);
    if (!title && !imageUrl) return null;
    return { title, imageUrl, detailPageUrl: productUrl, price };
  } catch (e) {
    console.warn("[enrich-amazon-asin] brightdata_failed", {
      asin,
      err: (e as Error).message,
    });
    return null;
  }
}

function parseAmazonTitle(html: string): string | null {
  let m = html.match(/<span[^>]*id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i);
  if (m) {
    const t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    if (t && !isGenericAmazonTitle(t)) return t.slice(0, 300);
  }
  m = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (m) {
    const t = decodeEntities(m[1]).trim();
    if (t && !isGenericAmazonTitle(t)) return t.slice(0, 300);
  }
  m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) {
    const t = decodeEntities(m[1])
      .replace(/\s*:\s*Amazon\.com.*$/i, "")
      .replace(/^Amazon\.com\s*:?\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (t && !isGenericAmazonTitle(t)) return t.slice(0, 300);
  }
  return null;
}

function isGenericAmazonTitle(t: string): boolean {
  return /^(amazon\.com|robot check|sorry|access denied)$/i.test(t.trim());
}

function parseAmazonImage(html: string): string | null {
  let m = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
          html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  let candidate = m ? m[1] : null;
  if (isAmazonProductImage(candidate)) return candidate;
  m = html.match(/id=["']landingImage["'][^>]*data-old-hires=["']([^"']+)["']/i) ??
      html.match(/id=["']landingImage["'][^>]*\ssrc=["']([^"']+)["']/i);
  if (m && isAmazonProductImage(m[1])) return m[1];
  m = html.match(/data-a-dynamic-image=["']\s*\{\s*&quot;([^&]+?)&quot;/i) ??
      html.match(/data-a-dynamic-image='\s*\{\s*"([^"]+?)"/i);
  if (m && isAmazonProductImage(m[1])) return m[1];
  return null;
}

function isAmazonProductImage(u: string | null): boolean {
  return !!u && /m\.media-amazon\.com\/images\/I\//.test(u);
}

// Best-effort current price off the /dp page. First a-offscreen inside the
// buybox a-price is the live price; fall back to priceblock + a-price-whole.
function parseAmazonPrice(html: string): number | null {
  const clean = (s: string) => {
    const n = parseFloat(s.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
  };
  let m = html.match(/class=["']a-offscreen["']>\s*\$\s*([0-9][0-9,]*\.?[0-9]{0,2})/i);
  if (m) { const n = clean(m[1]); if (n) return n; }
  m = html.match(/id=["']priceblock_(?:ourprice|dealprice|saleprice)["'][^>]*>\s*\$\s*([0-9][0-9,]*\.?[0-9]{0,2})/i);
  if (m) { const n = clean(m[1]); if (n) return n; }
  m = html.match(/class=["']a-price-whole["']>\s*([0-9][0-9,]*)[\s\S]{0,40}?class=["']a-price-fraction["']>\s*([0-9]{2})/i);
  if (m) { const n = clean(`${m[1]}.${m[2]}`); if (n) return n; }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// ────────────────────────────────────────────────
// Microlink — free last-resort. One ASIN per call. (No reliable price.)
// ────────────────────────────────────────────────
async function callMicrolink(asin: string): Promise<EnrichedFields | null> {
  const productUrl = `https://www.amazon.com/dp/${asin}`;
  const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(productUrl)}`;
  try {
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json || json.status !== "success" || !json.data) return null;
    const d = json.data as {
      title?: string;
      url?: string;
      image?: { url?: string };
    };
    let imageUrl = d.image?.url ?? null;
    const title = d.title?.slice(0, 300) ?? null;
    if (imageUrl && !/m\.media-amazon\.com\/images\/I\//.test(imageUrl)) {
      imageUrl = null;
    }
    if (!title && !imageUrl) return null;
    return {
      title,
      imageUrl,
      detailPageUrl: d.url ?? productUrl,
      price: null,
    };
  } catch (e) {
    console.warn("[enrich-amazon-asin] microlink_failed", {
      asin,
      err: (e as Error).message,
    });
    return null;
  }
}

// ────────────────────────────────────────────────
// PA-API call (signed with AWS Signature v4). Used when creds are set.
// ────────────────────────────────────────────────
interface PaApiItem {
  ASIN?: string;
  DetailPageURL?: string;
  ItemInfo?: { Title?: { DisplayValue?: string } };
  Images?: {
    Primary?: {
      Medium?: { URL?: string };
      Large?: { URL?: string };
    };
  };
  Offers?: {
    Listings?: Array<{ Price?: { Amount?: number; Currency?: string } }>;
  };
}

interface PaApiResponse {
  ItemsResult?: { Items?: PaApiItem[] };
  Errors?: Array<{ Code?: string; Message?: string }>;
}

async function callPaApiGetItems(asins: string[]): Promise<PaApiResponse> {
  const path = "/paapi5/getitems";
  const payload = JSON.stringify({
    ItemIds: asins,
    Resources: [
      "ItemInfo.Title",
      "Images.Primary.Medium",
      "Images.Primary.Large",
      "Offers.Listings.Price",
    ],
    PartnerTag: PARTNER_TAG,
    PartnerType: "Associates",
    Marketplace: "www.amazon.com",
  });

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "host": HOST,
    "content-type": "application/json; charset=UTF-8",
    "content-encoding": "amz-1.0",
    "x-amz-date": amzDate,
    "x-amz-target": TARGET,
  };

  const auth = await sigv4Authorization({
    method: "POST",
    path,
    queryString: "",
    headers,
    payload,
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    region: REGION,
    service: SERVICE,
    amzDate,
    dateStamp,
  });

  const res = await fetch(`https://${HOST}${path}`, {
    method: "POST",
    headers: {
      ...headers,
      "Authorization": auth,
    },
    body: payload,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`paapi_${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as PaApiResponse;
}

function toAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function sha256Hex(s: string | Uint8Array): Promise<string> {
  const data = typeof s === "string" ? new TextEncoder().encode(s) : s;
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  data: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

interface SigOpts {
  method: string;
  path: string;
  queryString: string;
  headers: Record<string, string>;
  payload: string;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  amzDate: string;
  dateStamp: string;
}

async function sigv4Authorization(opts: SigOpts): Promise<string> {
  const sortedHeaders = Object.keys(opts.headers).sort();
  const canonicalHeaders = sortedHeaders
    .map((h) => `${h.toLowerCase()}:${opts.headers[h].trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaders.map((h) => h.toLowerCase()).join(";");
  const payloadHash = await sha256Hex(opts.payload);
  const canonicalRequest = [
    opts.method,
    opts.path,
    opts.queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${opts.dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    opts.amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(
    new TextEncoder().encode(`AWS4${opts.secretKey}`),
    opts.dateStamp,
  );
  const kRegion = await hmacSha256(kDate, opts.region);
  const kService = await hmacSha256(kRegion, opts.service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const sigBuf = await hmacSha256(kSigning, opts.stringToSign ?? stringToSign);
  const signature = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
