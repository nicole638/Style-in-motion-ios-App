// watch-item — public endpoint for the shopper site's "Watch this item" button.
// POST { email, product_url, creator_id?, look_id?, website? (honeypot) }
// Resolution order: lookup_catalog_product RPC → murl-embedded match (Rakuten-style wrapped catalog URLs).
// GET ?action=unsubscribe&email=...&token=... → removes all watches for that email.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_WATCHES_PER_EMAIL = 50;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Product = { id: string; network: string; merchant_id: string | null; name: string | null; price: number | null; currency: string | null; image_url: string | null; product_url: string | null; sku: string | null; in_stock: boolean | null };

async function resolve(productUrl: string): Promise<Product | null> {
  // 1. Canonical RPC (handles Amazon ASINs + direct product_url matches)
  const { data } = await supabase.rpc("lookup_catalog_product", { p_url: productUrl });
  const hit = Array.isArray(data) ? data[0] : data;
  if (hit) return hit as Product;

  // 2. Wrapped catalog URLs (e.g. Rakuten linksynergy with ?murl=<encoded raw url>):
  //    match the encoded raw URL inside product_url. Try with and without the query string.
  for (const candidate of [productUrl, productUrl.split("?")[0]]) {
    const enc = encodeURIComponent(candidate).replace(/[%_]/g, (m) => "\\" + m); // escape LIKE wildcards
    const { data: rows } = await supabase
      .from("affiliate_products")
      .select("id, network, merchant_id, name, price, currency, image_urls, product_url, sku, in_stock")
      .like("product_url", `%${enc}%`)
      .limit(1);
    if (rows && rows[0]) {
      const r = rows[0] as Record<string, unknown>;
      return { ...r, image_url: Array.isArray(r.image_urls) ? (r.image_urls[0] as string ?? null) : null } as unknown as Product;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.get("action") === "unsubscribe") {
    const email = (url.searchParams.get("email") || "").trim().toLowerCase();
    const token = url.searchParams.get("token") || "";
    if (!email || !token) return new Response("Missing parameters", { status: 400, headers: CORS });
    const { data: match } = await supabase.from("watched_items").select("id").eq("email", email).eq("unsub_token", token).limit(1);
    if (!match || match.length === 0) return new Response("Link not valid", { status: 403, headers: CORS });
    await supabase.from("watched_items").delete().eq("email", email);
    return new Response("<html><body style='font-family:Georgia,serif;max-width:480px;margin:80px auto;text-align:center;color:#1a1a1a'><p style='letter-spacing:3px;text-transform:uppercase;font-size:12px'>Styled in Motion</p><h2 style='font-weight:normal'>You're unsubscribed.</h2><p style='color:#777'>No more price alerts. Come back any time.</p></body></html>", { headers: { ...CORS, "Content-Type": "text/html" } });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { email?: string; product_url?: string; creator_id?: string; look_id?: string; website?: string } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  if (body.website) return json({ ok: true }); // honeypot
  const email = (body.email || "").trim().toLowerCase();
  const productUrl = (body.product_url || "").trim();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
  if (!/^https?:\/\//.test(productUrl)) return json({ ok: false, error: "invalid_url" }, 400);

  const { count } = await supabase.from("watched_items").select("id", { count: "exact", head: true }).eq("email", email);
  if ((count ?? 0) >= MAX_WATCHES_PER_EMAIL) return json({ ok: false, error: "watch_limit_reached" }, 429);

  const p = await resolve(productUrl);
  if (!p) return json({ ok: false, error: "not_in_catalog" });

  const productKey = `${p.network}:${p.sku ?? p.id}`;
  const { error: insErr } = await supabase.from("watched_items").upsert({
    email,
    product_url: productUrl,
    network: p.network,
    product_key: productKey,
    catalog_product_id: p.id,
    sku: p.sku,
    merchant_id: p.merchant_id,
    name: p.name,
    image_url: p.image_url,
    currency: p.currency,
    price_at_save: p.price,
    in_stock_last: p.in_stock !== false,
    creator_id: body.creator_id || null,
    look_id: body.look_id || null,
  }, { onConflict: "email,product_key" });
  if (insErr) return json({ ok: false, error: "save_failed", detail: insErr.message.slice(0, 120) }, 500);

  return json({ ok: true, watching: { name: p.name, price: p.price, currency: p.currency } });
});
