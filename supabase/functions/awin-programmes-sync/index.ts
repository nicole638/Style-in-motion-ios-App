// awin-programmes-sync v1 — auto-discover + enrich joined Awin merchants.
//
// Pulls api.awin.com/publishers/{pubId}/programmes?relationship=joined,
// then per merchant pulls programmedetails for the full payload (logo,
// description, EPC, conversion rate, validDomains, commission range,
// awinIndex, validation days, primary sector, country, etc.).
//
// Upserts into awin_merchants keyed on awinmid. Auto-seeds new merchants
// when you join a new programme on Awin's side — no manual SQL.
//
// Rate limit: Awin caps at 20 req/min per user. With ~10 joined merchants,
// 1 list call + 10 detail calls = 11 calls. Well under the limit.
//
// Schedule via pg_cron daily — catches new joins + quality score updates.

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

  // Pull config
  const { data: cfg, error: cfgErr } = await supa
    .from("awin_publisher_config")
    .select("publisher_id, api_token")
    .eq("id", 1)
    .maybeSingle();
  if (cfgErr || !cfg?.api_token) {
    return jsonRes({ ok: false, error: "no_api_token", detail: "Set api_token in awin_publisher_config" }, 500);
  }

  const publisherId = cfg.publisher_id;
  const headers = {
    "Authorization": `Bearer ${cfg.api_token}`,
    "Accept": "application/json",
  };

  // ── 1. List joined programmes ──
  let programmes: any[];
  try {
    const r = await fetch(
      `${AWIN_API_BASE}/publishers/${publisherId}/programmes?relationship=joined`,
      { headers, signal: AbortSignal.timeout(30000) },
    );
    if (!r.ok) return jsonRes({ ok: false, error: `programmes_list_http_${r.status}`, detail: await r.text() }, 502);
    programmes = await r.json();
  } catch (e) {
    return jsonRes({ ok: false, error: `programmes_list_failed: ${(e as Error).message}` }, 502);
  }

  if (!Array.isArray(programmes)) {
    return jsonRes({ ok: false, error: "unexpected_programmes_shape", detail: JSON.stringify(programmes).slice(0, 400) }, 502);
  }

  // ── 2. For each joined programme, fetch details and upsert ──
  const results: any[] = [];
  const syncedAt = new Date().toISOString();

  for (const p of programmes) {
    const advId = String(p.id ?? p.advertiserId ?? "");
    if (!advId) continue;

    // Throttle to stay under 20/min Awin rate limit
    await sleep(150);

    let detail: any;
    try {
      const r = await fetch(
        `${AWIN_API_BASE}/publishers/${publisherId}/programmedetails?advertiserId=${advId}`,
        { headers, signal: AbortSignal.timeout(20000) },
      );
      if (!r.ok) {
        results.push({ awinmid: advId, name: p.name, ok: false, error: `details_http_${r.status}` });
        continue;
      }
      detail = await r.json();
    } catch (e) {
      results.push({ awinmid: advId, name: p.name, ok: false, error: `details_failed: ${(e as Error).message}` });
      continue;
    }

    const info = detail.programmeInfo ?? {};
    const kpi = detail.kpi ?? {};
    const commissions = Array.isArray(detail.commissionRange) ? detail.commissionRange : [];

    // Extract primary domain + alt_domains from validDomains.
    // First non-wildcard domain becomes the canonical `domain` field.
    // Wildcards (*.brand.com) and other entries land in alt_domains.
    const validDomains: Array<{ domain?: string }> = Array.isArray(info.validDomains) ? info.validDomains : [];
    const cleanDomains = validDomains
      .map((d) => (d.domain ?? "").trim().toLowerCase().replace(/^www\./, ""))
      .filter((d) => d.length > 0);
    const nonWildcard = cleanDomains.filter((d) => !d.startsWith("*"));
    const primaryDomain = nonWildcard[0] ??
      // Fall back to extracting host from displayUrl
      (info.displayUrl ? safeHost(info.displayUrl) : null) ??
      cleanDomains[0] ??
      null;
    const altDomains = cleanDomains.filter((d) => d !== primaryDomain);

    // Pick commission range across all rates (some merchants have tiers)
    let commissionMin: number | null = null;
    let commissionMax: number | null = null;
    for (const c of commissions) {
      const min = Number(c.min);
      const max = Number(c.max);
      if (Number.isFinite(min)) commissionMin = commissionMin === null ? min : Math.min(commissionMin, min);
      if (Number.isFinite(max)) commissionMax = commissionMax === null ? max : Math.max(commissionMax, max);
    }

    const upsertRow: Record<string, unknown> = {
      awinmid: advId,
      merchant_name: info.name ?? p.name ?? null,
      domain: primaryDomain,
      alt_domains: altDomains,
      status: info.membershipStatus === "Joined" ? "active" : "pending",
      commission_min: commissionMin,
      commission_max: commissionMax,
      logo_url: info.logoUrl ?? null,
      description: typeof info.description === "string" ? info.description.slice(0, 1024) : null,
      click_through_url: info.clickThroughUrl ?? null,
      membership_status: info.membershipStatus ?? null,
      link_status: info.linkStatus ?? null,
      primary_sector: info.primarySector ?? null,
      country_code: info.primaryRegion?.countryCode ?? null,
      currency_code: info.currencyCode ?? null,
      epc: numericOrNull(kpi.epc),
      conversion_rate: numericOrNull(kpi.conversionRate),
      approval_percentage: numericOrNull(kpi.approvalPercentage),
      average_payment_time: intOrNull(kpi.averagePaymentTime),
      validation_days: intOrNull(kpi.validationDays),
      awin_index: numericOrNull(kpi.awinIndex),
      programmes_last_synced_at: syncedAt,
    };

    const { error: upsertErr } = await supa
      .from("awin_merchants")
      .upsert(upsertRow, { onConflict: "awinmid" });

    if (upsertErr) {
      results.push({ awinmid: advId, name: info.name, ok: false, error: upsertErr.message.slice(0, 200) });
    } else {
      results.push({
        awinmid: advId, name: info.name,
        domain: primaryDomain, alt_domain_count: altDomains.length,
        commission: commissionMin === commissionMax ? `${commissionMin}%` : `${commissionMin}–${commissionMax}%`,
        epc: numericOrNull(kpi.epc),
        ok: true,
      });
    }
  }

  return jsonRes({
    ok: true,
    joined_count: programmes.length,
    synced_count: results.filter((r) => r.ok).length,
    failed_count: results.filter((r) => !r.ok).length,
    results,
  });
});

function safeHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function numericOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  const n = numericOrNull(v);
  return n === null ? null : Math.round(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
