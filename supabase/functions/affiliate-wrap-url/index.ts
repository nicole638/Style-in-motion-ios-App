import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWIN_API_BASE = "https://api.awin.com";
const AMAZON_MASTER_TAG = Deno.env.get("AMAZON_PA_API_PARTNER_TAG") ?? "styledinmotio-20";
const RAKUTEN_CLICK_BASE = "https://click.linksynergy.com/deeplink";
const CJ_CLICK_BASE = "https://www.kqzyfj.com";
const PB_GENERATE_LINK = "https://cj.partnerboost.com/api/generate_product_link";
const PB_ADVERTISER_CID = 7096926;
const PB_CLICK_BASE = "https://www.jdoqocy.com";
const PB_SMARTLINK_AD_ID = "15841657";
const PB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function extractHost(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
function hostMatchesMerchant(host, primary, alts) {
  if (!host) return false;
  if (primary) { const p = primary.toLowerCase().replace(/^www\./, ""); if (host === p) return true; }
  for (const a of alts ?? []) {
    const clean = a.toLowerCase().replace(/^www\./, "").trim();
    if (!clean) continue;
    if (clean.startsWith("*.")) { const suffix = clean.slice(2); if (host === suffix || host.endsWith("." + suffix)) return true; }
    else if (host === clean) return true;
  }
  return false;
}

function extractAmazonAsin(url) {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i].toLowerCase();
      if ((s === "dp" || s === "product" || s === "d") && segs[i + 1] && /^[A-Z0-9]{10}$/i.test(segs[i + 1])) {
        return segs[i + 1].toUpperCase();
      }
    }
    return null;
  } catch { return null; }
}
async function pbGenerate(pid, asin, sid) {
  try {
    const r = await fetch(PB_GENERATE_LINK, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Request-Source": "cj" },
      body: JSON.stringify({ pid, cid: PB_ADVERTISER_CID, country_code: "US", asins: asin, sid: sid ?? "" }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return { covered: false, link: null, maasUrl: null, error: true };
    const j = await r.json();
    if (j?.code === 0 && Array.isArray(j.data) && j.data[0]?.link) {
      const link = String(j.data[0].link);
      let maasUrl = null;
      try { maasUrl = new URL(link).searchParams.get("url"); } catch { /* */ }
      return { covered: true, link, maasUrl, error: false };
    }
    return { covered: false, link: null, maasUrl: null, error: false };
  } catch { return { covered: false, link: null, maasUrl: null, error: true }; }
}
function buildPbClickUrl(pid, maasUrl, sid) {
  return `${PB_CLICK_BASE}/click-${pid}-${PB_SMARTLINK_AD_ID}?url=${encodeURIComponent(maasUrl)}&sid=${encodeURIComponent(sid ?? "")}`;
}

// PartnerBoost DTC merchants: wrap any target URL on the merchant's domain
// using the merchant's click_through_url deeplink template, which looks like
// https://app.partnerboost.com/track/<token>?url=<encoded target>. We keep the
// /track/<token> base and swap in the real target (plus an optional sub_id).
function buildPbDtcUrl(template, targetUrl, sid) {
  try {
    const base = String(template).split("?")[0];
    if (!base) return null;
    const params = new URLSearchParams();
    params.set("url", targetUrl);
    if (sid && sid.trim().length > 0) params.set("sub_id", sid.trim());
    return `${base}?${params.toString()}`;
  } catch { return null; }
}

function buildRakutenUrl(destUrl, rakutenMid, publisherCode, u1) {
  const params = new URLSearchParams();
  params.set("id", publisherCode); params.set("mid", rakutenMid); params.set("murl", destUrl);
  if (u1 && u1.trim().length > 0) params.set("u1", u1.trim());
  return `${RAKUTEN_CLICK_BASE}?${params.toString()}`;
}
function buildCjUrl(destUrl, websiteId, universalLinkAdId, sid, sku) {
  const params = new URLSearchParams();
  params.set("url", destUrl);
  if (sid && sid.trim().length > 0) params.set("sid", sid.trim());
  if (sku && sku.trim().length > 0) params.set("cjsku", sku.trim());
  return `${CJ_CLICK_BASE}/click-${websiteId}-${universalLinkAdId}?${params.toString()}`;
}

async function resolveAmazonTag(supa, creatorId, clickEventId) {
  let resolvedCreatorId = creatorId?.trim() || null;
  if (!resolvedCreatorId && clickEventId) {
    const { data: ce } = await supa.from("click_events").select("creator_id").eq("id", clickEventId).maybeSingle();
    if (ce?.creator_id) resolvedCreatorId = ce.creator_id;
  }
  if (!resolvedCreatorId) return { tag: AMAZON_MASTER_TAG, source: "master_no_creator" };
  const { data: prof } = await supa.from("creator_profiles")
    .select("amazon_use_own_tag, amazon_own_tag_enabled, amazon_associates_tag").eq("creator_id", resolvedCreatorId).maybeSingle();
  if (prof?.amazon_use_own_tag === true && prof?.amazon_own_tag_enabled === true &&
      typeof prof?.amazon_associates_tag === "string" && prof.amazon_associates_tag.trim().length > 0) {
    return { tag: prof.amazon_associates_tag.trim(), source: "own" };
  }
  const { data: c } = await supa.from("creators").select("amazon_tracking_id").eq("id", resolvedCreatorId).maybeSingle();
  if (typeof c?.amazon_tracking_id === "string" && c.amazon_tracking_id.trim().length > 0) {
    return { tag: c.amazon_tracking_id.trim(), source: "creator_tracking_id" };
  }
  return { tag: AMAZON_MASTER_TAG, source: "master" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  let body = {};
  try { body = await req.json(); } catch { /* */ }
  const url = body.url?.trim();
  if (!url) return jsonRes({ ok: false, error: "missing_url" }, 400);

  const host = extractHost(url);
  if (!host) return jsonRes({ ok: false, original_url: url, wrapped_url: url, provider: "none", error: "invalid_url" });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (host === "amazon.com" || host.endsWith(".amazon.com") || host === "a.co") {
    try {
      const asin = extractAmazonAsin(url);
      if (asin) {
        const { data: pbCfg } = await supa.from("cj_publisher_config")
          .select("website_id, partnerboost_wrap_enabled").eq("is_default", true).maybeSingle();
        if (pbCfg?.partnerboost_wrap_enabled === true && pbCfg?.website_id) {
          const pid = parseInt(String(pbCfg.website_id), 10);
          const sid = (body.click_event_id || body.creator_id || "").trim() || null;
          if (Number.isFinite(pid)) {
            const { data: cached } = await supa.from("partnerboost_link_cache")
              .select("covered, maas_url, checked_at").eq("asin", asin).maybeSingle();
            const fresh = cached && (Date.now() - new Date(cached.checked_at).getTime() < PB_CACHE_TTL_MS);
            if (fresh) {
              if (cached.covered && cached.maas_url) {
                return jsonRes({
                  ok: true, original_url: url, wrapped_url: buildPbClickUrl(pid, cached.maas_url, sid),
                  provider: "partnerboost", partnerboost: { asin, sid, source: "cache" },
                  merchant: { name: "Amazon", cj_advertiser_id: String(PB_ADVERTISER_CID) },
                });
              }
            } else {
              const res = await pbGenerate(pid, asin, sid);
              if (!res.error) {
                await supa.from("partnerboost_link_cache")
                  .upsert({ asin, covered: res.covered, maas_url: res.maasUrl, checked_at: new Date().toISOString() }, { onConflict: "asin" });
              }
              if (res.covered && res.link) {
                return jsonRes({
                  ok: true, original_url: url, wrapped_url: res.link,
                  provider: "partnerboost", partnerboost: { asin, sid, source: "live" },
                  merchant: { name: "Amazon", cj_advertiser_id: String(PB_ADVERTISER_CID) },
                });
              }
            }
          }
        }
      }
      const { tag, source } = await resolveAmazonTag(supa, body.creator_id, body.click_event_id);
      const u = new URL(url);
      u.searchParams.set("tag", tag);
      if (body.click_event_id) u.searchParams.set("ascsubtag", body.click_event_id);
      return jsonRes({
        ok: true, original_url: url, wrapped_url: u.toString(),
        provider: "amazon", amazon_tag: tag, amazon_tag_source: source, merchant: { name: "Amazon" },
      });
    } catch (e) {
      return jsonRes({ ok: false, original_url: url, wrapped_url: url, provider: "amazon", error: `amazon_wrap_failed: ${e.message}` });
    }
  }

  const [{ data: rakMerchants }, { data: awinMerchants }, { data: cjMerchants }] = await Promise.all([
    supa.from("rakuten_merchants").select("id, rakuten_mid, merchant_name, domain, alt_domains").is("archived_at", null).eq("status", "active"),
    supa.from("awin_merchants").select("id, awinmid, merchant_name, domain, alt_domains").is("archived_at", null).eq("status", "active"),
    supa.from("cj_merchants").select("id, cj_advertiser_id, merchant_name, domain, alt_domains, universal_link_ad_id").is("archived_at", null).eq("status", "active"),
  ]);

  const cjMerchant = (cjMerchants ?? []).find((m) => hostMatchesMerchant(host, m.domain, m.alt_domains));
  if (cjMerchant) {
    if (!cjMerchant.universal_link_ad_id) {
      return jsonRes({ ok: false, original_url: url, wrapped_url: url, provider: "cj",
        merchant: { id: cjMerchant.id, name: cjMerchant.merchant_name, cj_advertiser_id: cjMerchant.cj_advertiser_id }, error: "no_universal_link_ad_id_on_merchant" });
    }
    const { data: cjCfg } = await supa.from("cj_publisher_config").select("website_id").eq("is_default", true).maybeSingle();
    if (!cjCfg?.website_id) {
      return jsonRes({ ok: false, original_url: url, wrapped_url: url, provider: "cj",
        merchant: { id: cjMerchant.id, name: cjMerchant.merchant_name, cj_advertiser_id: cjMerchant.cj_advertiser_id }, error: "no_cj_website_id" });
    }
    const wrapped = buildCjUrl(url, cjCfg.website_id, cjMerchant.universal_link_ad_id, body.click_event_id ?? null, body.sku ?? null);
    return jsonRes({ ok: true, original_url: url, wrapped_url: wrapped, provider: "cj",
      merchant: { id: cjMerchant.id, name: cjMerchant.merchant_name, cj_advertiser_id: cjMerchant.cj_advertiser_id } });
  }

  const rakMerchant = (rakMerchants ?? []).find((m) => hostMatchesMerchant(host, m.domain, m.alt_domains));
  if (rakMerchant) {
    const { data: rakCfg } = await supa.from("rakuten_publisher_config").select("publisher_code, sid").eq("is_default", true).maybeSingle();
    if (!rakCfg?.publisher_code) {
      return jsonRes({ ok: false, original_url: url, wrapped_url: url, provider: "rakuten",
        merchant: { id: rakMerchant.id, name: rakMerchant.merchant_name, rakuten_mid: rakMerchant.rakuten_mid, advertiser_id: Number(rakMerchant.rakuten_mid) }, error: "no_rakuten_publisher_code" });
    }
    const wrapped = buildRakutenUrl(url, String(rakMerchant.rakuten_mid), rakCfg.publisher_code, body.click_event_id ?? null);
    return jsonRes({ ok: true, original_url: url, wrapped_url: wrapped, provider: "rakuten",
      merchant: { id: rakMerchant.id, name: rakMerchant.merchant_name, rakuten_mid: rakMerchant.rakuten_mid, advertiser_id: Number(rakMerchant.rakuten_mid) } });
  }

  const awinMerchant = (awinMerchants ?? []).find((m) => hostMatchesMerchant(host, m.domain, m.alt_domains));
  if (!awinMerchant) {
    // PartnerBoost DTC merchants (e.g. ShaperX DTC): wrap any target on the
    // merchant domain via its click_through_url deeplink template.
    const { data: pbMerchants } = await supa.from("affiliate_merchants")
      .select("id, merchant_name, domain, alt_domains, click_through_url, network_mid")
      .eq("network", "partnerboost").eq("status", "active")
      .ilike("click_through_url", "%/track/%");
    const pbMerchant = (pbMerchants ?? []).find((m) => hostMatchesMerchant(host, m.domain, m.alt_domains));
    if (pbMerchant?.click_through_url) {
      const wrapped = buildPbDtcUrl(pbMerchant.click_through_url, url, (body.click_event_id || "").trim() || null);
      if (wrapped) {
        return jsonRes({ ok: true, original_url: url, wrapped_url: wrapped, provider: "partnerboost",
          merchant: { id: pbMerchant.id, name: pbMerchant.merchant_name, network_mid: pbMerchant.network_mid } });
      }
    }
    return jsonRes({ ok: true, original_url: url, wrapped_url: url, provider: "none" });
  }

  const { data: cfg } = await supa.from("awin_publisher_config").select("publisher_id, api_token").eq("id", 1).maybeSingle();
  if (!cfg?.api_token || !cfg?.publisher_id) {
    return jsonRes({ ok: false, original_url: url, wrapped_url: url, provider: "awin",
      merchant: { id: awinMerchant.id, name: awinMerchant.merchant_name, awinmid: awinMerchant.awinmid }, error: "no_awin_token" });
  }
  try {
    const r = await fetch(`${AWIN_API_BASE}/publishers/${cfg.publisher_id}/linkbuilder/generate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cfg.api_token}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ advertiserId: Number(awinMerchant.awinmid), destinationUrl: url, shorten: body.shorten === true }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* */ }
    if (!r.ok || !json?.url) {
      return jsonRes({ ok: false, original_url: url, wrapped_url: url, provider: "awin",
        merchant: { id: awinMerchant.id, name: awinMerchant.merchant_name, awinmid: awinMerchant.awinmid, advertiser_id: Number(awinMerchant.awinmid) }, error: json?.description ?? `link_builder_http_${r.status}` });
    }
    return jsonRes({ ok: true, original_url: url, wrapped_url: json.url, short_url: json.shortUrl ?? null, shortened: !!json.shortUrl, provider: "awin",
      merchant: { id: awinMerchant.id, name: awinMerchant.merchant_name, awinmid: awinMerchant.awinmid, advertiser_id: Number(awinMerchant.awinmid) } });
  } catch (e) {
    return jsonRes({ ok: false, original_url: url, wrapped_url: url, provider: "awin",
      merchant: { id: awinMerchant.id, name: awinMerchant.merchant_name, awinmid: awinMerchant.awinmid }, error: `link_builder_failed: ${e.message.slice(0, 200)}` });
  }
});
