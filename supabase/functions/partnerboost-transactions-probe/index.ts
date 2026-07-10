// partnerboost-transactions-probe — ONE-OFF diagnostic. Calls PartnerBoost's
// Transaction API (mod=medium&op=transaction) with the publisher token + a
// date window, and records the raw response shape into pb_transactions_probe
// so we can map fields for the real partnerboost-transactions-sync EF.
// Tries JSON POST first, falls back to form-encoded. verify_jwt=false so it
// can be invoked from a one-shot net.http_post like the other sync crons.
//
// Body (all optional): { begin_date:'YYYY-MM-DD', end_date:'YYYY-MM-DD', channel_token:'...' }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const PB_TXN_URL = "https://app.partnerboost.com/api.php?mod=medium&op=transaction";

function jsonRes(b: unknown, s = 200) {
  return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } });
}
function ymd(d: Date) { return d.toISOString().slice(0, 10); }

function findRecords(j: any): any[] | null {
  if (!j) return null;
  if (Array.isArray(j.data)) return j.data;
  if (Array.isArray(j?.data?.list)) return j.data.list;
  if (Array.isArray(j?.data?.transactions)) return j.data.transactions;
  if (Array.isArray(j?.transactions)) return j.transactions;
  if (Array.isArray(j?.data?.data)) return j.data.data;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!PB_TOKEN) return jsonRes({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const end = body.end_date ?? ymd(new Date());
  const begin = body.begin_date ?? ymd(new Date(Date.now() - 120 * 864e5));
  const token = body.channel_token ?? PB_TOKEN;

  const attempts: any[] = [];
  let chosen: { status: number; text: string; j: any } | null = null;

  // Attempt 1: JSON body (matches partnerboost-brands-sync convention)
  try {
    const r = await fetch(PB_TXN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, begin_date: begin, end_date: end }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
    attempts.push({ mode: "json", status: r.status, code: j?.status?.code ?? j?.code ?? null, snippet: text.slice(0, 200) });
    if (r.status === 200 && j) chosen = { status: r.status, text, j };
  } catch (e) { attempts.push({ mode: "json", error: String(e).slice(0, 150) }); }

  // Attempt 2: form-encoded fallback (PartnerBoost docs list x-www-form-urlencoded)
  if (!chosen) {
    try {
      const form = new URLSearchParams({ token, begin_date: begin, end_date: end });
      const r = await fetch(PB_TXN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(30000),
      });
      const text = await r.text();
      let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
      attempts.push({ mode: "form", status: r.status, code: j?.status?.code ?? j?.code ?? null, snippet: text.slice(0, 200) });
      if (r.status === 200 && j) chosen = { status: r.status, text, j };
    } catch (e) { attempts.push({ mode: "form", error: String(e).slice(0, 150) }); }
  }

  const j = chosen?.j ?? null;
  const records = findRecords(j);
  const code = j?.status?.code ?? j?.code ?? null;
  const keys = records && records[0] && typeof records[0] === "object" ? Object.keys(records[0]) : null;
  const sample = records ? records.slice(0, 3) : null;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  await supa.from("pb_transactions_probe").insert({
    http_status: chosen?.status ?? null,
    api_code: code === null ? null : String(code),
    row_count: records ? records.length : null,
    record_keys: keys,
    raw: j ?? { attempts },
    sample,
  });

  return jsonRes({
    ok: !!chosen,
    window: { begin, end },
    attempts,
    api_code: code,
    row_count: records ? records.length : null,
    record_keys: keys,
    sample,
  });
});
