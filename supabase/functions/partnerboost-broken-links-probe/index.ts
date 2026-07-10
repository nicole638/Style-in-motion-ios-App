// partnerboost-broken-links-probe — finds the Broken Links API endpoint.
// Writes the result to pb_transactions_probe (raw) so it's readable regardless of timing.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function findRecords(j: any): any[] | null {
  if (!j) return null;
  if (Array.isArray(j.data)) return j.data;
  if (Array.isArray(j?.data?.list)) return j.data.list;
  if (Array.isArray(j?.data?.data)) return j.data.data;
  if (Array.isArray(j?.list)) return j.list;
  return null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!PB_TOKEN) return json({ error: "no token" }, 500);
  const end = ymd(new Date()); const begin = ymd(new Date(Date.now() - 7 * 864e5));
  const candidates = [
    "https://app.partnerboost.com/api/datafeed/get_broken_links",
    "https://app.partnerboost.com/api/datafeed/get_broken_link",
    "https://app.partnerboost.com/api/datafeed/get_broken_link_list",
    "https://app.partnerboost.com/api.php?mod=medium&op=broken_links",
    "https://app.partnerboost.com/api.php?mod=medium&op=broken_link_list",
    "https://app.partnerboost.com/api.php?mod=coupon&op=broken_links",
    "https://app.partnerboost.com/api.php?mod=link&op=broken_links",
    "https://app.partnerboost.com/api.php?mod=medium&op=invalid_links",
  ];
  const bodies = [
    { token: PB_TOKEN, page: 1, page_size: 50 },
    { token: PB_TOKEN, page_num: 1, page_size: 50, start_date: begin, end_date: end },
  ];
  const attempts: any[] = [];
  let hit: any = null;
  for (const url of candidates) {
    for (const b of bodies) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), signal: AbortSignal.timeout(10000) });
        const text = await r.text();
        let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
        const code = j?.status?.code ?? j?.code ?? null;
        const recs = findRecords(j);
        const ok = r.status === 200 && (code === 0 || code === "0");
        attempts.push({ url: url.replace("https://app.partnerboost.com", ""), body: Object.keys(b).filter((k) => k !== "token"), status: r.status, code, msg: j?.status?.msg ?? null, has_records: !!recs });
        if (ok) { hit = { url, body_keys: Object.keys(b).filter((k) => k !== "token"), record_keys: recs?.[0] ? Object.keys(recs[0]) : null, sample: recs?.slice(0, 2) ?? j }; break; }
      } catch (e) { attempts.push({ url: url.replace("https://app.partnerboost.com", ""), error: String(e).slice(0, 80) }); }
    }
    if (hit) break;
  }
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  await supa.from("pb_transactions_probe").insert({ http_status: 200, api_code: hit ? "broken_found" : "broken_none", row_count: hit?.sample?.length ?? 0, raw: { found: !!hit, hit, attempts } });
  return json({ found: !!hit, hit, attempts });
});
