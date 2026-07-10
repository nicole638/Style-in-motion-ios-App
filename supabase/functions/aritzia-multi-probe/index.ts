// aritzia-multi-probe v2 — slim battery: direct, basic, premium_us, stealth+ai_extract.
// Drops the two stealth-HTML tests proven useless for Aritzia.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SCRAPINGBEE_KEY = Deno.env.get("SCRAPINGBEE_API_KEY") ?? "";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

interface TestResult {
  label: string;
  ok: boolean;
  http_status: number;
  initial_status?: number | null;
  latency_ms: number;
  credits_used: number | null;
  body_bytes?: number;
  has_og_image?: boolean;
  has_jsonld_product?: boolean;
  fields: Record<string, unknown> | null;
  notes: string[];
}

function extractQuickFields(html: string) {
  const ogMatch = (re: RegExp): string | null => {
    const a = html.match(new RegExp(`<meta[^>]*${re.source}[^>]*content=["']([^"']*)["']`, "i"));
    const b = html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${re.source}`, "i"));
    return a ? a[1] : (b ? b[1] : null);
  };
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? null;
  let jsonLdProduct: Record<string, unknown> | null = null;
  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = ldRe.exec(html)) !== null) {
    try {
      const j = JSON.parse(m[1].trim());
      const items: any[] = Array.isArray(j) ? j : (j["@graph"] ?? [j]);
      const product = items.find((x: any) => {
        const t = x?.["@type"];
        return Array.isArray(t)
          ? t.some((s: any) => String(s).toLowerCase() === "product")
          : String(t).toLowerCase() === "product";
      });
      if (product) { jsonLdProduct = product; break; }
    } catch { /* skip */ }
  }
  const jsonLdImage = jsonLdProduct
    ? (Array.isArray((jsonLdProduct as any).image)
        ? (jsonLdProduct as any).image[0]
        : (jsonLdProduct as any).image ?? null)
    : null;
  const jsonLdPrice = jsonLdProduct
    ? ((jsonLdProduct as any).offers?.price
        ?? (Array.isArray((jsonLdProduct as any).offers) ? (jsonLdProduct as any).offers[0]?.price : null)
        ?? (jsonLdProduct as any).offers?.lowPrice
        ?? null)
    : null;
  return {
    title,
    og_title: ogMatch(/property=["']og:title["']/i),
    og_site_name: ogMatch(/property=["']og:site_name["']/i),
    og_image: ogMatch(/property=["']og:image["']/i),
    og_price: ogMatch(/property=["']og:price:amount["']/i) ?? ogMatch(/property=["']product:price:amount["']/i),
    jsonld_name: (jsonLdProduct as any)?.name ?? null,
    jsonld_brand: (jsonLdProduct as any)?.brand?.name ?? (jsonLdProduct as any)?.brand ?? null,
    jsonld_price: jsonLdPrice,
    jsonld_image: jsonLdImage,
  };
}

async function testDirect(url: string): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const text = await r.text();
    const f = extractQuickFields(text);
    const hasOg = !!f.og_image;
    const hasLd = /\"@type\"\s*:\s*\"Product\"/i.test(text);
    const usable = !!f.og_image || !!f.jsonld_name;
    const notes: string[] = [];
    if (text.length < 5000) notes.push("body small — likely bot wall");
    if (/captcha|access denied|are you a human|cf-ray|cloudflare/i.test(text.slice(0, 5000))) {
      notes.push("page mentions captcha/cloudflare/access-denied in first 5KB");
    }
    return {
      label: "1_direct", ok: r.ok && usable, http_status: r.status,
      latency_ms: Date.now() - t0, credits_used: 0, body_bytes: text.length,
      has_og_image: hasOg, has_jsonld_product: hasLd, fields: f, notes,
    };
  } catch (e) {
    return { label: "1_direct", ok: false, http_status: 0, latency_ms: Date.now() - t0,
      credits_used: 0, fields: null, notes: [(e as Error).message] };
  }
}

async function testSbHtml(label: string, baseParams: Record<string, string>): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const qp = new URLSearchParams({ api_key: SCRAPINGBEE_KEY, ...baseParams });
    const r = await fetch(`https://app.scrapingbee.com/api/v1/?${qp.toString()}`, {
      signal: AbortSignal.timeout(120000),
    });
    const credits = Number(r.headers.get("Spb-cost") ?? r.headers.get("spb-cost") ?? 0);
    const initialStatus = Number(r.headers.get("Spb-initial-status-code") ?? r.headers.get("spb-initial-status-code") ?? 0);
    const text = await r.text();
    const f = r.ok ? extractQuickFields(text) : null;
    const hasOg = !!f?.og_image;
    const hasLd = /\"@type\"\s*:\s*\"Product\"/i.test(text);
    const usable = !!f?.og_image || !!f?.jsonld_name;
    const notes: string[] = [];
    if (!r.ok) notes.push(`scrapingbee ${r.status}: ${text.slice(0, 200)}`);
    return {
      label, ok: r.ok && usable, http_status: r.status,
      initial_status: initialStatus || null, latency_ms: Date.now() - t0,
      credits_used: credits || null, body_bytes: text.length,
      has_og_image: hasOg, has_jsonld_product: hasLd, fields: f, notes,
    };
  } catch (e) {
    return { label, ok: false, http_status: 0, latency_ms: Date.now() - t0,
      credits_used: null, fields: null, notes: [(e as Error).message] };
  }
}

async function testSbAi(label: string, baseParams: Record<string, string>): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const qp = new URLSearchParams({ api_key: SCRAPINGBEE_KEY, ...baseParams });
    const r = await fetch(`https://app.scrapingbee.com/api/v1/?${qp.toString()}`, {
      signal: AbortSignal.timeout(120000),
    });
    const headerCredits = Number(r.headers.get("Spb-cost") ?? r.headers.get("spb-cost") ?? 0);
    let json: any = null;
    try { json = await r.json(); } catch { /* */ }
    if (!json) {
      return { label, ok: false, http_status: r.status, latency_ms: Date.now() - t0,
        credits_used: headerCredits || null, fields: null, notes: ["non-JSON response"] };
    }
    const credits = Number(json?.cost) || headerCredits || null;
    const initialStatus = Number(json?.["initial-status-code"]) || null;
    let parsed: Record<string, unknown> | null = null;
    if (typeof json?.ai_response === "string") {
      try { parsed = JSON.parse(json.ai_response); } catch { /* */ }
    }
    return {
      label, ok: r.ok && !!parsed && (!!(parsed as any).product_name || !!(parsed as any).name),
      http_status: r.status, initial_status: initialStatus,
      latency_ms: Date.now() - t0, credits_used: credits,
      fields: parsed, notes: parsed ? [] : ["ai_response missing or unparseable"],
    };
  } catch (e) {
    return { label, ok: false, http_status: 0, latency_ms: Date.now() - t0,
      credits_used: null, fields: null, notes: [(e as Error).message] };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  if (!SCRAPINGBEE_KEY) return jsonRes({ error: "no_scrapingbee_key" }, 500);
  let body: { url?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const url = body.url;
  if (!url) return jsonRes({ error: "missing_url" }, 400);

  const tests: Array<Promise<TestResult>> = [
    testDirect(url),
    testSbHtml("2_sb_basic", {
      url, render_js: "true", block_resources: "false", wait: "2500",
    }),
    testSbHtml("3_sb_premium_us", {
      url, render_js: "true", premium_proxy: "true", country_code: "us",
      block_resources: "false", wait: "3000",
    }),
    testSbAi("4_sb_stealth_mobile_ai", {
      url, render_js: "true", stealth_proxy: "true", country_code: "us",
      device: "mobile", wait: "5000",
      ai_extract_rules: JSON.stringify({
        product_name: "the full product name as displayed on the page",
        brand: "the brand or manufacturer name",
        price_usd: "the current selling price in USD as a number (no currency symbol)",
        main_product_image_url: "the highest quality main product image URL",
        all_image_urls: "comma-separated list of all product image URLs visible on the page, in display order, highest quality versions",
        in_stock: "true if the product is available for purchase, false otherwise",
      }),
      json_response: "true",
    }),
  ];

  const results = await Promise.all(tests);
  return jsonRes({ url, tested_at: new Date().toISOString(), results });
});
