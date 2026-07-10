// awin-offers-sync v2 — fix voucher code path (Awin nests it at
// o.voucher.code, not o.voucherCode), pick up o.voucher.exclusive too.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWIN_API_BASE = "https://api.awin.com";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: cfg } = await supa.from("awin_publisher_config")
    .select("publisher_id, api_token").eq("id", 1).maybeSingle();
  if (!cfg?.api_token) return jsonRes({ ok: false, error: "no_api_token" }, 500);

  const publisherId = cfg.publisher_id;
  const headers = {
    "Authorization": `Bearer ${cfg.api_token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const { data: merchants } = await supa.from("awin_merchants")
    .select("id, awinmid").eq("status", "active");
  const mid2id = new Map<string, string>();
  for (const m of merchants ?? []) mid2id.set(String(m.awinmid), m.id);

  const syncStartedAt = new Date().toISOString();
  let totalSeen = 0;
  const perStatus: Record<string, number> = { active: 0, expiringSoon: 0, upcoming: 0 };

  for (const statusFilter of ["active", "expiringSoon", "upcoming"] as const) {
    let page = 1;
    while (true) {
      const resp = await fetch(
        `${AWIN_API_BASE}/publisher/${publisherId}/promotions`,
        {
          method: "POST", headers,
          body: JSON.stringify({
            filters: { membership: "joined", status: statusFilter, type: "all" },
            pagination: { page, pageSize: 200 },
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!resp.ok) {
        const detail = await resp.text();
        return jsonRes({ ok: false, error: `http_${resp.status}`, detail: detail.slice(0, 400) }, 502);
      }
      const json = await resp.json();
      const items: any[] = json?.data ?? [];
      perStatus[statusFilter] += items.length;

      const rows = items.map((o) => {
        const advId = String(o?.advertiser?.id ?? "");
        // Voucher code lives at o.voucher.code, not o.voucherCode.
        // Exclusive flag also lives inside o.voucher when it's a voucher.
        const voucherCode = o?.voucher?.code ?? null;
        const exclusiveFlag = (typeof o?.voucher?.exclusive === "boolean")
          ? o.voucher.exclusive
          : !!o.exclusive;
        return {
          promotion_id: String(o.promotionId),
          merchant_id: mid2id.get(advId) ?? null,
          awinmid: advId,
          type: o.type,
          title: (o.title ?? "").slice(0, 300),
          description: typeof o.description === "string" ? o.description.slice(0, 1024) : null,
          terms: typeof o.terms === "string" ? o.terms.slice(0, 10000) : null,
          voucher_code: voucherCode,
          campaign: o.campaign ?? null,
          start_date: o.startDate ?? null,
          end_date: o.endDate ?? null,
          status: o.status ?? statusFilter,
          url: o.url ?? null,
          url_tracking: o.urlTracking ?? null,
          exclusive: exclusiveFlag,
          all_regions: o.regions?.all ?? true,
          region_codes: Array.isArray(o.regions?.regions) ? o.regions.regions : [],
          categories: Array.isArray(o.categories) ? o.categories.map((c: any) => String(c.name ?? c)) : [],
          date_added: o.dateAdded ?? null,
          last_seen_at: syncStartedAt,
          removed_at: null,
          updated_at: syncStartedAt,
        };
      });

      if (rows.length > 0) {
        const { error } = await supa.from("awin_offers")
          .upsert(rows, { onConflict: "promotion_id" });
        if (error) return jsonRes({ ok: false, error: `upsert: ${error.message}` }, 500);
      }
      totalSeen += items.length;

      const pagination = json?.pagination ?? {};
      const total = pagination.total ?? items.length;
      const pageSize = pagination.pageSize ?? 200;
      if (page * pageSize >= total || items.length === 0) break;
      page++;
    }
  }

  let tombstoned = 0;
  const { count } = await supa.from("awin_offers")
    .update({ removed_at: new Date().toISOString() }, { count: "exact" })
    .is("removed_at", null)
    .lt("last_seen_at", syncStartedAt);
  tombstoned = count ?? 0;

  return jsonRes({
    ok: true,
    synced_at: syncStartedAt,
    total_offers_seen: totalSeen,
    per_status: perStatus,
    tombstoned,
  });
});
