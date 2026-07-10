// swap-suggestion v2 — monetize an existing non-monetized closet item by pointing it
// at an affiliate product the matcher found. Reuses affiliate-wrap-url so per-network
// attribution (Amazon creator-tag / CJ / Rakuten / Awin / PartnerBoost) matches every
// other monetized item. One endpoint serves both the add-time card and the Studio strip.
//
// v2: unwrap network tracking URLs before wrapping. Feed product_urls are often the
//     already-wrapped network link (Rakuten LinkSynergy ?murl=, CJ ?url=, Awin ?ued=)
//     whose HOST is the redirector, not the merchant — affiliate-wrap-url matches by host,
//     so it'd return provider:'none'. unwrapTrackingUrl() extracts the real destination
//     first, restoring correct per-creator attribution for those (most Rakuten + some CJ).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// CJ tracking redirector hosts (destination is in the ?url= param).
const CJ_TRACK_HOSTS = new Set([
  "kqzyfj.com", "jdoqocy.com", "dpbolvw.com", "tkqlhce.com", "anrdoezrs.net",
  "emjcd.com", "ftjcfx.com", "qksrv.net", "lduhtrp.net", "yceml.net",
]);

// Network tracking links carry the real merchant URL in a param; affiliate-wrap-url
// matches by host, so extract the destination first. Unwrap up to 2 nested layers.
function unwrapTrackingUrl(raw: string): string {
  let current = raw;
  for (let i = 0; i < 2; i++) {
    let dest: string | null = null;
    try {
      const u = new URL(current);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host.endsWith("linksynergy.com")) {
        dest = u.searchParams.get("murl") ?? u.searchParams.get("RD_PARM1");
      } else if (host.endsWith("awin1.com") || host.endsWith("dwin1.com")) {
        dest = u.searchParams.get("ued");
      } else if (CJ_TRACK_HOSTS.has(host)) {
        dest = u.searchParams.get("url");
      }
    } catch { break; }
    if (!dest) break;
    let decoded = dest;
    try { decoded = decodeURIComponent(dest); } catch { /* keep raw */ }
    if (!/^https?:\/\//i.test(decoded)) break;
    current = decoded;
  }
  return current;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ ok: false, error: "method_not_allowed" }, 405);

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* */ }
  const creatorId = (body.creator_id ?? "").trim();
  const itemId = (body.creator_item_id ?? "").trim();
  const productUrl = (body.product_url ?? "").trim();
  const suggestionId = (body.suggestion_id ?? "").trim() || null;
  if (!creatorId || !itemId || !productUrl) return jsonRes({ ok: false, error: "missing_params" }, 400);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Ownership guard: only the owning creator can re-wrap their own item.
  const { data: item, error: itemErr } = await supa
    .from("creator_items").select("id, creator_id, affiliate_url").eq("id", itemId).maybeSingle();
  if (itemErr) return jsonRes({ ok: false, error: "item_lookup_failed" }, 500);
  if (!item) return jsonRes({ ok: false, error: "item_not_found" }, 404);
  if (item.creator_id !== creatorId) return jsonRes({ ok: false, error: "not_your_item" }, 403);

  // Unwrap any network tracking link to its real merchant destination, then build the
  // per-network affiliate link via the canonical wrapper.
  const wrapTarget = unwrapTrackingUrl(productUrl);
  let wrap: { ok?: boolean; wrapped_url?: string; provider?: string; merchant?: unknown; error?: string } = {};
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/affiliate-wrap-url`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_ROLE}`, "apikey": SERVICE_ROLE, "Content-Type": "application/json" },
      body: JSON.stringify({ url: wrapTarget, creator_id: creatorId }),
    });
    wrap = await r.json();
  } catch (e) {
    return jsonRes({ ok: false, error: `wrap_call_failed: ${(e as Error).message}` }, 502);
  }
  if (!wrap?.ok || !wrap?.wrapped_url || wrap?.provider === "none") {
    return jsonRes({ ok: false, error: "wrap_unavailable", provider: wrap?.provider ?? null, detail: wrap?.error ?? null }, 422);
  }

  // Persist the affiliate fields on the item (same shape as every other monetized item).
  const now = new Date().toISOString();
  const { error: updErr } = await supa.from("creator_items")
    .update({ affiliate_url: wrap.wrapped_url, affiliate_provider: wrap.provider, affiliate_wrapped_at: now })
    .eq("id", itemId);
  if (updErr) return jsonRes({ ok: false, error: "item_update_failed" }, 500);

  // Mark the chosen suggestion swapped (Studio strip). Add-time live matches have no row;
  // the item is now monetized so it drops out of both surfaces, and the nightly sweep prunes siblings.
  if (suggestionId) {
    await supa.from("closet_affiliate_suggestions").update({ status: "swapped", refreshed_at: now }).eq("id", suggestionId);
  }

  return jsonRes({ ok: true, affiliate_url: wrap.wrapped_url, provider: wrap.provider, merchant: wrap.merchant ?? null });
});
