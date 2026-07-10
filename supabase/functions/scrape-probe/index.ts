// scrape-probe v3 — single-config probe.
// Pass config_name in body to pick which technique to test.
// Avoids the serial-timeout issue from v2 which tried 5 configs at once.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SCRAPINGBEE_KEY = Deno.env.get("SCRAPINGBEE_API_KEY") ?? "";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function baseParams(targetUrl: string) {
  return {
    api_key: SCRAPINGBEE_KEY,
    url: targetUrl,
    render_js: "true",
    stealth_proxy: "true",
    country_code: "us",
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  let body: { url?: string; config?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const targetUrl = body.url;
  const configName = body.config ?? "mobile_ai_query";
  if (!targetUrl) return jsonRes({ error: "missing_url" }, 400);
  if (!SCRAPINGBEE_KEY) return jsonRes({ error: "no_scrapingbee_key" }, 500);

  const configs: Record<string, { params: Record<string, string>; isJson: boolean }> = {
    mobile_basic: {
      params: { ...baseParams(targetUrl), device: "mobile", wait: "5000" },
      isJson: false,
    },
    mobile_ai_query: {
      params: {
        ...baseParams(targetUrl), device: "mobile", wait: "5000",
        ai_query: "Extract product name, brand, price (USD), and main product image URL. Return JSON.",
        json_response: "true",
      },
      isJson: true,
    },
    desktop_ai_query: {
      params: {
        ...baseParams(targetUrl), wait: "5000",
        ai_query: "Extract product name, brand, price (USD), and main product image URL. Return JSON.",
        json_response: "true",
      },
      isJson: true,
    },
    mobile_screenshot: {
      // Diagnostic: return a screenshot so we can SEE what page ScrapingBee got
      params: { ...baseParams(targetUrl), device: "mobile", wait: "6000", screenshot: "true" },
      isJson: false,
    },
    ai_extract_structured: {
      params: {
        ...baseParams(targetUrl), device: "mobile", wait: "5000",
        ai_extract_rules: JSON.stringify({
          name: "the full product name",
          brand: "the brand or manufacturer",
          price: "the price in USD",
          image: "the main product image URL",
        }),
        json_response: "true",
      },
      isJson: true,
    },
  };

  const cfg = configs[configName];
  if (!cfg) return jsonRes({ error: "unknown_config", available: Object.keys(configs) }, 400);

  const t0 = Date.now();
  let r: Response;
  try {
    const urlParams = new URLSearchParams(cfg.params);
    r = await fetch(
      `https://app.scrapingbee.com/api/v1/?${urlParams.toString()}`,
      { signal: AbortSignal.timeout(120000) },
    );
  } catch (e) {
    return jsonRes({ ok: false, config: configName, error: (e as Error).message, latency_ms: Date.now() - t0 }, 502);
  }

  const latency = Date.now() - t0;
  const status = r.status;
  const ct = r.headers.get("content-type") ?? "";

  // If it's an image (screenshot), just return the size — don't try to parse
  if (ct.startsWith("image/")) {
    const bytes = new Uint8Array(await r.arrayBuffer()).byteLength;
    return jsonRes({ ok: status === 200, config: configName, http_status: status, latency_ms: latency, content_type: ct, screenshot_bytes: bytes });
  }

  if (cfg.isJson) {
    try {
      const json = await r.json();
      return jsonRes({
        ok: status === 200,
        config: configName,
        http_status: status,
        latency_ms: latency,
        content_type: ct,
        ai_response: json,
      });
    } catch (e) {
      return jsonRes({ ok: false, config: configName, error: `json_parse: ${(e as Error).message}`, latency_ms: latency, http_status: status }, 502);
    }
  }

  const text = await r.text();
  return jsonRes({
    ok: status === 200,
    config: configName,
    http_status: status,
    latency_ms: latency,
    content_type: ct,
    body_bytes: text.length,
    has_og_image: /property=["']og:image["']/i.test(text),
    has_jsonld_product: /"@type"\s*:\s*"Product"/i.test(text),
    body_preview: text.slice(0, 600),
  });
});
