// partnerboost-postback — receiver for PartnerBoost Global Postback (real-time
// conversion pings). Validates ?secret=, resolves creator via uid/click_ref
// (our click_event_id), upserts into commissions (affiliate_network=
// 'partnerboost', dedupe on order_id). Mirrors rakuten-postback.
//
// Configure in PB console (Tools → Global Postback) with this URL + the [[macros]]:
//   .../partnerboost-postback?secret=<SECRET>&order_id=[[order_id]]&...&uid=[[uid]]

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } }); }
function num(v: string | null): number | null { if (v === null) return null; const n = parseFloat(v.replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; }
function toIso(v: string | null): string | null { if (!v) return null; const t = Date.parse(v.replace(" ", "T")); return Number.isFinite(t) ? new Date(t).toISOString() : null; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  const url = new URL(req.url);
  let body: Record<string, string> = {};
  if (req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("application/json")) { const j = await req.json(); body = j && typeof j === "object" ? j : {}; }
      else { const f = await req.formData(); body = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)])); }
    } catch { /* */ }
  }
  const get = (n: string): string | null => { const v = url.searchParams.get(n) ?? (body as any)[n]; return (v === null || v === undefined || v === "") ? null : String(v); };

  const { data: cfg } = await supabase.from("partnerboost_postback_config").select("postback_secret").limit(1).maybeSingle();
  if (!cfg?.postback_secret || get("secret") !== cfg.postback_secret) return json({ error: "forbidden" }, 403);

  const orderId = get("order_id");
  if (!orderId) return json({ error: "no_order_id" }, 400);

  let clickEventId: string | null = null, creatorId: string | null = null;
  for (const k of ["uid", "click_ref", "uid2", "uid3", "uid4", "uid5"]) { const v = get(k); if (v && UUID_RE.test(v)) { clickEventId = v.toLowerCase(); break; } }
  if (clickEventId) { const { data: ce } = await supabase.from("click_events").select("creator_id").eq("id", clickEventId).maybeSingle(); creatorId = ce?.creator_id ?? null; }

  const statusRaw = (get("status") || "").toLowerCase();
  const status = /approv|confirm|paid|valid/.test(statusRaw) ? "confirmed" : /reject|declin|cancel|invalid/.test(statusRaw) ? "rejected" : "pending";
  const orderDate = toIso(get("order_time")) ?? new Date().toISOString();

  const row: Record<string, unknown> = {
    affiliate_network: "partnerboost",
    affiliate_transaction_id: orderId,
    creator_id: creatorId,
    click_event_id: clickEventId,
    merchant_name: get("merchant_name"),
    sale_amount: num(get("sale_amount")),
    commission_total: num(get("sale_comm")),
    order_date: orderDate,
    status,
    confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
  };
  const keep = new Set(["affiliate_network", "affiliate_transaction_id", "status", "confirmed_at", "order_date", "creator_id", "click_event_id", "sale_amount", "commission_total"]);
  const payload = Object.fromEntries(Object.entries(row).filter(([k, v]) => keep.has(k) || (v !== null && v !== undefined)));

  const { error } = await supabase.from("commissions").upsert(payload, { onConflict: "affiliate_network,affiliate_transaction_id" });
  if (error) return json({ ok: false, error: error.message.slice(0, 150) }, 500);
  return json({ ok: true, order_id: orderId, attributed: !!creatorId, status });
});
