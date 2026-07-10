// partnerboost-brands-sync v4 — pulls JOINED brands from PartnerBoost's
// Monetization API (op=monetization_api, relationship=Joined) into
// partnerboost_merchants → Brands tab via affiliate_merchants view.
// Token: PARTNERBOOST_API_TOKEN secret (per-channel). Field mapping matches
// the REAL response (comm_rate / site_url / logo / track url), confirmed live.
// v4: archive (tombstone) ONLY rows managed='monetization_api' so the synthetic
//     'walmart-marketplace' (managed='manual') is never archived. Amazon-type
//     brands are captured here as the brand_id registry but HIDDEN from the
//     Brands tab by the affiliate_merchants view (they feed the Amazon card).
// POST body: { dry_run?: bool }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const PB_BRANDS_URL = "https://app.partnerboost.com/api.php?mod=medium&op=monetization_api";

function jsonRes(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}
function parseCommission(raw: unknown): { min: number | null; max: number | null; raw: string | null } {
  if (typeof raw !== "string" || !raw.trim()) return { min: null, max: null, raw: null };
  const nums = (raw.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return { min: null, max: null, raw };
  return { min: Math.min(...nums), max: Math.max(...nums), raw };
}
function toArr(c: unknown): string[] {
  if (Array.isArray(c)) return c.map((x) => String(x).trim()).filter(Boolean);
  if (typeof c === "string" && c.trim()) return c.split(/[,/|]/).map((s) => s.trim()).filter(Boolean);
  return [];
}
function hostOf(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  try {
    const url = u.includes("://") ? u : `https://${u}`;
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}
async function pbBrands() {
  const r = await fetch(PB_BRANDS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: PB_TOKEN, relationship: "Joined" }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json: j, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  if (!PB_TOKEN) return jsonRes({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const dryRun = body?.dry_run === true;

  const { status, json, text } = await pbBrands();
  const code = json?.status?.code ?? json?.code;
  const data = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.data?.list) ? json.data.list : null);
  if (status !== 200 || code !== 0 || !Array.isArray(data)) {
    return jsonRes({ ok: false, error: `pb_monetization status=${status} code=${code}`, sample: (text || "").slice(0, 400) }, 502);
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const nowIso = new Date().toISOString();

  const rows = data.map((b: any) => {
    const c = parseCommission(b.comm_rate ?? b.commission ?? b.commission_rate ?? b.rate);
    const cats = toArr(b.categories ?? b.category ?? b.tags);
    const link = b.tracking_url ?? b.track_url ?? b.url ?? b.smart_url ?? b.link ?? null;
    const domain = hostOf(b.site_url ?? b.website ?? b.domain ?? null);
    return {
      pb_brand_id: String(b.brand_id ?? b.mid ?? b.bid ?? "").trim(),
      mcid: b.mcid ?? null,
      merchant_name: b.merchant_name ?? b.brand_name ?? b.name ?? "(unnamed)",
      domain,
      commission_min: c.min, commission_max: c.max, commission_raw: c.raw,
      brand_type: b.brand_type ?? null,
      offer_type: b.offer_type ?? null,
      approval_type: b.approval_type ?? null,
      relationship: b.relationship ?? "Joined",
      categories: cats,
      primary_sector: cats[0] ?? null,
      logo_url: b.logo ?? b.logo_url ?? b.brand_logo ?? (domain ? `https://icon.horse/icon/${domain}` : null),
      description: b.description ?? b.comm_detail ?? null,
      click_through_url: link,
      country_code: b.country ?? b.support_region ?? "US",
      currency_code: "USD",
      status: String(b.merchant_status ?? "").toLowerCase() === "offline" ? "inactive" : "active",
      archived_at: null,
      raw: b,
      feed_last_synced_at: nowIso,
      updated_at: nowIso,
    };
  }).filter((r: any) => r.pb_brand_id);

  if (dryRun) return jsonRes({ ok: true, dry_run: true, fetched: data.length, mappable: rows.length, brand_ids: rows.map((r:any)=>r.pb_brand_id), sample: rows.slice(0, 3) });

  const { error } = await supa.from("partnerboost_merchants").upsert(rows, { onConflict: "pb_brand_id" });
  if (error) return jsonRes({ ok: false, error: `upsert: ${error.message.slice(0, 200)}` }, 500);

  // Tombstone: only monetization-managed rows not seen this run. NEVER the synthetic
  // 'walmart-marketplace' (managed='manual').
  let archived = 0;
  const { data: arch } = await supa.from("partnerboost_merchants")
    .update({ archived_at: nowIso, status: "archived", updated_at: nowIso })
    .is("archived_at", null)
    .eq("managed", "monetization_api")
    .lt("feed_last_synced_at", nowIso)
    .select("id");
  archived = arch?.length ?? 0;

  return jsonRes({ ok: true, fetched: data.length, upserted: rows.length, archived });
});
