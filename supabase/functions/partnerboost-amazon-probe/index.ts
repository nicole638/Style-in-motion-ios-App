// partnerboost-amazon-probe — date-format probe for get_amazon_report.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
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
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const op = body.op ?? "get_amazon_report";
  const url = `https://app.partnerboost.com/api/datafeed/${op}`;
  const variants: Record<string, unknown>[] = [
    { start_date: "2026-06-29", end_date: "2026-06-30" },
    { start_date: "2026-06", end_date: "2026-06" },
    { start_date: "06/29/2026", end_date: "06/30/2026" },
    { start_date: "2026-06-29 00:00:00", end_date: "2026-06-30 23:59:59" },
    { start_date: "2026-06-01", end_date: "2026-06-30" },
    { start_date: "1717027200", end_date: "1719619200" },
  ];
  const attempts: any[] = [];
  let chosen: any = null; let chosenV: any = null;
  for (const v of variants) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: PB_TOKEN, page: 1, ...v }), signal: AbortSignal.timeout(20000) });
      const text = await r.text();
      let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
      const code = j?.status?.code ?? j?.code ?? null;
      const recs = findRecords(j);
      attempts.push({ start_date: v.start_date, code, msg: j?.status?.msg ?? null, has_records: !!recs });
      if (r.status === 200 && (code === 0 || code === "0" || recs)) { chosen = j; chosenV = v; break; }
    } catch (e) { attempts.push({ start_date: v.start_date, error: String(e).slice(0, 100) }); }
  }
  const recs = findRecords(chosen);
  return json({ op, working_format: chosenV?.start_date ?? null, attempts, record_count: recs?.length ?? null, total: chosen?.total ?? chosen?.data?.total ?? null, record_keys: recs?.[0] && typeof recs[0] === "object" ? Object.keys(recs[0]) : null, sample: recs?.slice(0, 2) ?? null });
});
