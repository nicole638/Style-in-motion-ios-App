// send-price-alerts — daily check of watched_items against the freshly-refreshed
// affiliate_products catalog. Resolution by stable catalog keys (network+sku, else catalog_product_id).
//   price_drop:  current <= 95% of the last price we told the shopper about
//   back_in_stock: was out of stock at last check, now in stock
// Cron: 12:00 UTC daily (catalog matview refreshes 10:30 UTC). Body: { dry_run?: boolean }. Cap 50 emails/run.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("WELCOME_FROM_EMAIL") ?? "Styled in Motion <hello@styledinmotion.studio>";
const SHOP_REDIRECT = "https://meadow-grindstone.vibecode.run/api/shop";
const UNSUB_BASE = "https://rghlcnrttvlvphzahudf.supabase.co/functions/v1/watch-item";
const DROP_THRESHOLD = 0.95;
const MAX_EMAILS = 50;

const money = (v: number, cur: string | null) => `${cur === "USD" || !cur ? "$" : cur + " "}${Number(v).toFixed(2)}`;

function emailHtml(kind: "drop" | "restock", w: Record<string, unknown>, newPrice: number | null): { subject: string; html: string } {
  const name = String(w.name ?? "your watched item");
  const cur = (w.currency as string) ?? "USD";
  const oldP = Number(w.last_alerted_price ?? w.price_at_save ?? 0);
  const shopUrl = `${SHOP_REDIRECT}?url=${encodeURIComponent(String(w.product_url))}&source=web`;
  const unsub = `${UNSUB_BASE}?action=unsubscribe&email=${encodeURIComponent(String(w.email))}&token=${w.unsub_token}`;
  const img = w.image_url ? `<p style="margin:0 0 24px;"><img src="${w.image_url}" alt="" width="200" style="max-width:200px;border-radius:4px;"/></p>` : "";
  const inner = kind === "drop"
    ? `<h1 style="font-size:24px;font-weight:normal;line-height:1.3;margin:0 0 24px;">Price drop on something you're watching 👀</h1>
       ${img}
       <p style="font-size:16px;line-height:1.6;margin:0 0 8px;"><strong>${name}</strong></p>
       <p style="font-size:18px;line-height:1.6;margin:0 0 24px;"><span style="text-decoration:line-through;color:#999;">${money(oldP, cur)}</span> → <strong>${money(newPrice!, cur)}</strong></p>
       <p style="margin:0 0 24px;"><a href="${shopUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;font-size:15px;letter-spacing:1px;">Shop it before it's gone →</a></p>`
    : `<h1 style="font-size:24px;font-weight:normal;line-height:1.3;margin:0 0 24px;">It's back — grab it this time</h1>
       ${img}
       <p style="font-size:16px;line-height:1.6;margin:0 0 24px;"><strong>${name}</strong> is back in stock${newPrice ? ` at ${money(newPrice, cur)}` : ""}.</p>
       <p style="margin:0 0 24px;"><a href="${shopUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;font-size:15px;letter-spacing:1px;">Shop it now →</a></p>`;
  return {
    subject: kind === "drop" ? `Price drop: ${name.slice(0, 60)}` : `Back in stock: ${name.slice(0, 60)}`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#faf8f5;">
      <div style="max-width:560px;margin:0 auto;padding:40px 24px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
        <p style="font-size:13px;letter-spacing:3px;text-transform:uppercase;margin:0 0 32px;">Styled in Motion</p>
        ${inner}
        <hr style="border:none;border-top:1px solid #e5e0d8;margin:40px 0 16px;"/>
        <p style="font-size:12px;color:#999;line-height:1.5;">You asked us to watch this item on styledinmotion.studio. <a href="${unsub}" style="color:#999;">Stop all price alerts</a>.</p>
      </div></body></html>`,
  };
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) console.error("resend", res.status, (await res.text()).slice(0, 150));
  return res.ok;
}

type Current = { price: number | null; in_stock: boolean };

async function currentState(w: Record<string, unknown>): Promise<Current | null> {
  let q = supabase.from("affiliate_products").select("price, in_stock").limit(1);
  if (w.sku && w.network) q = q.eq("network", w.network).eq("sku", w.sku);
  else if (w.catalog_product_id) q = q.eq("id", w.catalog_product_id);
  else return null;
  const { data } = await q;
  if (!data || !data[0]) return null; // gone from catalog = treat as out of stock
  return { price: data[0].price === null ? null : Number(data[0].price), in_stock: data[0].in_stock !== false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500 });
  let body: { dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* */ }

  const { data: watches, error } = await supabase.from("watched_items").select("*");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!watches || watches.length === 0) return new Response(JSON.stringify({ ok: true, checked: 0, alerts: 0 }), { headers: { "Content-Type": "application/json" } });

  const plan: Array<{ w: Record<string, unknown>; kind: "drop" | "restock"; newPrice: number | null }> = [];
  const wentOos: string[] = [];
  for (const w of watches) {
    const cur = await currentState(w);
    const inStock = cur ? cur.in_stock : false;
    if (w.in_stock_last === true && !inStock) { wentOos.push(w.id); continue; }
    if (!cur) continue;
    const ref = Number(w.last_alerted_price ?? w.price_at_save ?? 0);
    if (inStock && cur.price !== null && ref > 0 && cur.price <= ref * DROP_THRESHOLD) {
      plan.push({ w, kind: "drop", newPrice: cur.price });
    } else if (inStock && w.in_stock_last === false) {
      plan.push({ w, kind: "restock", newPrice: cur.price });
    }
  }

  if (body.dry_run) {
    return new Response(JSON.stringify({ ok: true, dry_run: true, checked: watches.length, would_alert: plan.length, going_out_of_stock: wentOos.length, plan: plan.map(x => ({ email: x.w.email, kind: x.kind, name: x.w.name, newPrice: x.newPrice })) }), { headers: { "Content-Type": "application/json" } });
  }

  let sent = 0;
  for (const { w, kind, newPrice } of plan.slice(0, MAX_EMAILS)) {
    const t = emailHtml(kind, w, newPrice);
    if (await send(String(w.email), t.subject, t.html)) {
      sent++;
      await supabase.from("watched_items").update({
        last_alerted_price: kind === "drop" ? newPrice : w.last_alerted_price,
        in_stock_last: true,
      }).eq("id", w.id);
    }
  }
  for (const id of wentOos) {
    await supabase.from("watched_items").update({ in_stock_last: false }).eq("id", id);
  }

  return new Response(JSON.stringify({ ok: true, checked: watches.length, alerts: sent, marked_out_of_stock: wentOos.length }), { headers: { "Content-Type": "application/json" } });
});
