// rakuten-advertisers-sync EF v5 — v4 + robust domain parse.
// v5: advertiser URLs missing a scheme (e.g. "cami.com", "//famousfootwear.ca")
// made new URL() throw → "no usable domain from url" → partnership dropped (CAMI,
// Famous Footwear Canada). normalizeDomain now prepends https:// when no scheme
// is present (and falls back to a host regex), and click_through_url is stored
// with a scheme.
// v4: network 5 = CA (not AU); default pull US + CA partnerships.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAKUTEN_API = "https://api.linksynergy.com";
const RAKUTEN_TOKEN_ENDPOINT = "https://api.linksynergy.com/token";
const THROTTLE_MS = 220;
const CACHE_SKEW_MS = 60_000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// Ensure a URL string has a scheme so new URL() can parse it.
function withScheme(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  const s = String(rawUrl).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return "https://" + s.replace(/^\/\//, "");
}

function normalizeDomain(rawUrl: string | undefined | null): string | null {
  const schemed = withScheme(rawUrl);
  if (schemed) {
    try { return new URL(schemed).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { /* fall through to regex */ }
  }
  // last resort: pull the first host-looking token out of the raw string
  const m = String(rawUrl ?? "").match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
  return m ? m[0].toLowerCase().replace(/^www\./, "") : null;
}

function networkToCountry(network: number | undefined): string | null {
  switch (network) {
    case 1: return "US";
    case 2: return "GB";
    case 3: return "GB";
    case 5: return "CA";
    case 7: return "AU";
    default: return null;
  }
}

interface ConfigRow {
  sid: string; client_id: string; client_secret: string;
  access_token: string | null; access_token_expires_at: string | null;
  refresh_token: string | null; is_default: boolean;
}

async function loadConfig(sid: string | null): Promise<ConfigRow> {
  let q = supabase.from("rakuten_publisher_config").select("*");
  q = sid ? q.eq("sid", sid) : q.eq("is_default", true);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`config lookup: ${error.message}`);
  if (!data) throw new Error(`no rakuten_publisher_config row for sid=${sid ?? '<default>'}`);
  return data as ConfigRow;
}

async function callTokenEndpoint(tokenKey: string, body: URLSearchParams) {
  const res = await fetch(RAKUTEN_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Authorization": `Bearer ${tokenKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token endpoint status=${res.status} body=${await res.text()}`);
  return await res.json() as { access_token: string; refresh_token: string; expires_in: number; token_type: string };
}

async function ensureValidToken(cfg: ConfigRow): Promise<string> {
  const now = Date.now();
  const expiresAt = cfg.access_token_expires_at ? new Date(cfg.access_token_expires_at).getTime() : 0;
  if (cfg.access_token && expiresAt - now > CACHE_SKEW_MS) return cfg.access_token;
  const tokenKey = btoa(`${cfg.client_id}:${cfg.client_secret}`);
  let tok;
  if (cfg.refresh_token) {
    try {
      tok = await callTokenEndpoint(tokenKey, new URLSearchParams({
        grant_type: "refresh_token", refresh_token: cfg.refresh_token, scope: cfg.sid,
      }));
    } catch (e) { console.log(`refresh failed for sid=${cfg.sid}, falling back to fresh: ${e}`); }
  }
  if (!tok) tok = await callTokenEndpoint(tokenKey, new URLSearchParams({ scope: cfg.sid }));
  const newExpiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  await supabase.from("rakuten_publisher_config").update({
    access_token: tok.access_token, access_token_expires_at: newExpiresAt,
    refresh_token: tok.refresh_token, updated_at: new Date().toISOString(),
  }).eq("sid", cfg.sid);
  return tok.access_token;
}

async function rakGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${RAKUTEN_API}${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function fetchAllPartnerships(token: string): Promise<any[]> {
  const all: any[] = []; let page = 1; const limit = 100;
  while (true) {
    const data = await rakGet(`/v1/partnerships?page=${page}&limit=${limit}`, token);
    const items = data.partnerships ?? [];
    all.push(...items);
    const total = data?._metadata?.total ?? items.length;
    if (page * limit >= total || items.length < limit) break;
    page++;
    await sleep(THROTTLE_MS);
  }
  return all;
}

async function fetchAdvertiser(id: number, token: string): Promise<any | null> {
  try { return (await rakGet(`/v2/advertisers/${id}`, token))?.advertiser ?? null; }
  catch (e) { console.error(`advertiser ${id}:`, e); return null; }
}

async function fetchPrimaryOffer(advId: number, token: string): Promise<any | null> {
  try {
    const data = await rakGet(`/v1/offers?offer_status=active&advertiser=${advId}&limit=20`, token);
    const offers = data?.offers ?? [];
    if (!offers.length) return null;
    const withBase = offers.find((o: any) => (o.offer_rules ?? []).some((r: any) => r.is_base_commission));
    return withBase ?? offers[0];
  } catch (e) { console.error(`offers ${advId}:`, e); return null; }
}

function extractCommissionRange(offer: any) {
  if (!offer || !Array.isArray(offer.offer_rules)) return { min: null, max: null, desc: null };
  const baseRule = offer.offer_rules.find((r: any) => r.is_base_commission) ?? offer.offer_rules[0];
  if (!baseRule) return { min: null, max: null, desc: null };
  let min: number | null = null, max: number | null = null, desc: string | null = null;
  for (const c of (baseRule.commissions ?? [])) {
    if (typeof c.description === "string" && !desc) desc = c.description;
    for (const t of (c.tiers ?? [])) {
      if (typeof t.commission === "number") {
        min = min === null ? t.commission : Math.min(min, t.commission);
        max = max === null ? t.commission : Math.max(max, t.commission);
      }
    }
  }
  return { min, max, desc };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const networksParam = url.searchParams.get("networks") ?? "1,5";
  const allowedNetworks = networksParam.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
  const includePending = url.searchParams.get("include_pending") === "1";
  const sid = url.searchParams.get("sid");

  const errors: Array<{ id: number; name?: string; error: string }> = [];
  let processed = 0, upserted = 0, skipped = 0;
  const startedAt = new Date().toISOString();

  let cfg: ConfigRow, token: string;
  try {
    cfg = await loadConfig(sid);
    token = await ensureValidToken(cfg);
  } catch (e) {
    return new Response(JSON.stringify({ error: "auth failed", detail: String(e) }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  let partnerships: any[];
  try {
    partnerships = await fetchAllPartnerships(token);
  } catch (e) {
    return new Response(JSON.stringify({ error: "partnerships fetch failed", detail: String(e) }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  for (const p of partnerships) {
    const a = p.advertiser ?? {};
    const advId: number = a.id;
    const network: number = a.network;
    const pStatus: string = p.status ?? "pending";

    if (allowedNetworks.length && !allowedNetworks.includes(network)) { skipped++; continue; }
    if (!includePending && pStatus !== "active") { skipped++; continue; }

    processed++;
    try {
      const adv = await fetchAdvertiser(advId, token);
      await sleep(THROTTLE_MS);
      const offer = await fetchPrimaryOffer(advId, token);
      await sleep(THROTTLE_MS);

      const advUrl: string | null = adv?.url ?? null;
      const advUrlHttps = withScheme(advUrl);
      const domain = normalizeDomain(advUrl);
      if (!domain) {
        errors.push({ id: advId, name: a.name, error: `no usable domain from url=${advUrl}` });
        continue;
      }

      const { min, max, desc } = extractCommissionRange(offer);
      const row = {
        rakuten_mid: String(advId),
        network,
        merchant_name: a.name ?? adv?.name ?? `Rakuten Advertiser ${advId}`,
        domain,
        partnership_status: pStatus,
        advertiser_status: a.status ?? adv?.status ?? null,
        can_partner: adv?.can_partner ?? null,
        status_update_datetime: p.status_update_datetime ?? null,
        apply_datetime: p.apply_datetime && !p.apply_datetime.startsWith("0001-") ? p.apply_datetime : null,
        approve_datetime: p.approve_datetime && !p.approve_datetime.startsWith("0001-") ? p.approve_datetime : null,
        status: pStatus === "active" ? "active" : pStatus === "pending" ? "pending" : "paused",
        offer_goid: offer?.goid ?? null,
        offer_number: offer?.offer_number ?? null,
        offer_name: offer?.name ?? null,
        commission_min: min,
        commission_max: max,
        commission_description: desc,
        return_days: offer?.return_days ?? null,
        update_window: offer?.update_window ?? null,
        categories: a.categories ?? adv?.categories ?? [],
        logo_url: adv?.logo_url ?? null,
        terms_url: offer?.terms_url ?? null,
        click_through_url: advUrlHttps,
        ships_to: adv?.policies?.international_capabilities?.ships_to ?? null,
        country_code: networkToCountry(network),
        partnerships_last_synced_at: startedAt,
        offers_last_synced_at: offer ? startedAt : null,
        details_last_synced_at: adv ? startedAt : null,
        updated_at: startedAt,
      };

      const { error: upErr } = await supabase.from("rakuten_merchants")
        .upsert(row, { onConflict: "rakuten_mid" });
      if (upErr) errors.push({ id: advId, name: a.name, error: upErr.message });
      else upserted++;
    } catch (e) {
      errors.push({ id: advId, name: a.name, error: String(e) });
    }
  }

  return new Response(
    JSON.stringify({
      partnerships_total: partnerships.length,
      processed, upserted, skipped, errors,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
