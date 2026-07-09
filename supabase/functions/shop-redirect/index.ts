// shop-redirect — Supabase Edge Function port of the Hono backend's
// /api/shop route (backend/src/routes/shop-redirect.ts), migrated off
// Vibecode 2026-07-09. Logic is verbatim from the Hono route; only the
// framework surface changed (Hono ctx → Deno.serve Request/Response) plus
// ONE addition: click_events.served_by = 'edge', the adoption marker that
// tells us when old app builds (which hit the legacy meadow-grindstone
// backend, leaving served_by null) have drained.
//
// verify_jwt=false — this is a public browser-navigation redirect (a shopper
// tapping "Shop"), exactly like rakuten-postback / awin-webhook. It performs
// its own input validation + an open-redirect guard on the ?url= entry mode.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// AMAZON_PLATFORM_ASSOCIATES_TAG falls back through AMAZON_PA_API_PARTNER_TAG
// to the literal master tag — all three resolve to the same value today
// (styledinmotio-20, verified against backend/.env AND affiliate-wrap-url's
// fallback). RAKUTEN_PUBLISHER_ID is deliberately NOT set in production —
// the inline raw-Rakuten branch is dead on the legacy backend too; raw
// Rakuten URLs flow through the affiliate-wrap-url delegation, which reads
// rakuten_publisher_config. Keeping the branch (and its env gate) preserves
// exact production behavior while leaving the fast-path ready to light up.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const AMAZON_PLATFORM_ASSOCIATES_TAG =
  Deno.env.get("AMAZON_PLATFORM_ASSOCIATES_TAG") ??
  Deno.env.get("AMAZON_PA_API_PARTNER_TAG") ??
  "styledinmotio-20";
const RAKUTEN_PUBLISHER_ID = Deno.env.get("RAKUTEN_PUBLISHER_ID") ?? "";

let _admin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  _admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return _admin;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const AMAZON_HOST_RE = /(^|\.)(amazon\.[a-z.]+|a\.co|amzn\.to)$/i;
// Matches /dp/, /gp/product/, /gp/aw/d/, /product/ ASIN path segments.
const ASIN_PATH_RE = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
const ASIN_PARAM_RE = /[?&]asin=([A-Z0-9]{10})\b/i;

export function isAmazonHost(url: string): boolean {
  try { return AMAZON_HOST_RE.test(new URL(url).hostname); } catch { return false; }
}

// Awin deep-link host is awin1.com (or www.awin1.com), and the click-tracker
// endpoint is /cread.php?awinmid=…&awinaffid=…&clickref=…&p=<merchant_url>.
// We only recognize URLs that are ALREADY Awin-wrapped — raw merchant URLs
// (e.g. bolsanova.com) are a separate later phase.
export function isAwinUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      (host === 'awin1.com' || host === 'www.awin1.com') &&
      u.pathname.startsWith('/cread.php')
    );
  } catch {
    return false;
  }
}

// Stamp the current creator's clickref onto an outbound Awin URL.
// URL.searchParams.set handles both add-if-missing and replace-if-present.
// We deliberately do NOT touch p=, awinmid, or awinaffid — those determine
// the merchant destination and the publisher credit.
export function rewriteAwinUrl(awinUrl: string, creatorSlug: string): string {
  const u = new URL(awinUrl);
  u.searchParams.set('clickref', creatorSlug);
  return u.toString();
}

// Extract the merchant destination domain from an Awin click-tracker URL.
// The p= query param carries the URL-encoded final merchant URL; URL
// parsing already decodes it, so we just parse hostname and strip www.
// Returns null on any parse failure so the caller can fall back gracefully.
export function extractAwinMerchantDomain(awinUrl: string): string | null {
  try {
    const u = new URL(awinUrl);
    const p = u.searchParams.get('p');
    if (!p) return null;
    const merchant = new URL(p);
    return merchant.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Rakuten (LinkSynergy) — publisher deep link.
//
// Rakuten deep links are served from click.linksynergy.com:
//   https://click.linksynergy.com/deeplink?id=<PUB_ID>&mid=<MERCHANT_ID>
//                                          &murl=<ENCODED_MERCHANT_URL>&u1=<SUBID>
//   (older /link?id=…&offerid=… form has no murl — destination is the offer)
// The link already carries the publisher credit (id/mid). We only stamp `u1`
// — Rakuten's publisher sub-id — with our click_event_id so the commission
// postback (which echoes u1) reconciles back to this click_events row. This
// mirrors Awin `clickref` and Amazon `ascsubtag`. We never touch id/mid/murl.
export function isRakutenUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'click.linksynergy.com' ||
      host === 'linksynergy.com' ||
      host === 'www.linksynergy.com'
    );
  } catch {
    return false;
  }
}

// Stamp our click_event_id onto the Rakuten deep link's u1 sub-id param.
// set() adds-if-missing / replaces-if-present, so we never duplicate u1.
export function rewriteRakutenUrl(rakutenUrl: string, subId: string): string {
  const u = new URL(rakutenUrl);
  u.searchParams.set('u1', subId);
  return u.toString();
}

// Extract the merchant destination domain from a Rakuten deep link's murl=
// param (the URL-encoded final merchant URL). Returns null for the offerid
// form or any parse failure so the caller can fall back gracefully.
export function extractRakutenMerchantDomain(rakutenUrl: string): string | null {
  try {
    const u = new URL(rakutenUrl);
    const murl = u.searchParams.get('murl');
    if (!murl) return null;
    const merchant = new URL(murl);
    return merchant.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Build a Rakuten LinkSynergy deep link wrapping `targetUrl` (the murl), for a
// raw brand URL whose merchant we matched to a rakuten_mid. Pure function — no
// DB, no network. Mirrors the format affiliate-wrap-url / rakuten-events-sync
// expect:
//   https://click.linksynergy.com/deeplink?id=<PUB>&mid=<MID>&murl=<ENC>&u1=<SUBID>
// `u1` = our click_event_id; rakuten-events-sync echoes it back to attribute the
// sale to the creator (the Rakuten analogue of CJ `sid` / PartnerBoost `uid`).
// We encodeURIComponent each part so the murl destination round-trips intact and
// the param order matches the documented deeplink shape.
export function buildRakutenDeepLink(
  targetUrl: string,
  publisherId: string,
  mid: string,
  subId: string,
): string {
  const id = encodeURIComponent(publisherId);
  const m = encodeURIComponent(mid);
  const murl = encodeURIComponent(targetUrl);
  const u1 = encodeURIComponent(subId);
  return `https://click.linksynergy.com/deeplink?id=${id}&mid=${m}&murl=${murl}&u1=${u1}`;
}

// ────────────────────────────────────────────────────────────────────────────
// PartnerBoost — DTC + Walmart track-link sub-id.
//
// PartnerBoost track links come from partnerboost_merchants.click_through_url
// (built by the affiliate-wrap-url EF, or occasionally already the item URL):
//   https://app.partnerboost.com/track/<TOKEN>?url=<ENCODED_DESTINATION>
// PartnerBoost's Transaction API echoes a sub-id back on each conversion, so we
// stamp our click_event_id there; partnerboost-transactions-sync then resolves
// the DTC/Walmart sale back to a creator via click_events.id. PartnerBoost's
// SubID macro is `uid` (Tools → API → Global Postback exposes [uid], plus
// uid2–uid5 and click_ref — there is no [sub_id] macro), and the same uid
// round-trips back on both the postback and the Transaction API, so uid
// attributes correctly.
//
// We append by RAW STRING so the track <TOKEN> and the ?url= destination stay
// byte-for-byte intact — round-tripping through URLSearchParams would re-encode
// the destination. No-op for any non-PartnerBoost URL; never double-stamps.
export function isPartnerBoostTrackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.toLowerCase().endsWith('partnerboost.com') &&
      u.pathname.includes('/track/')
    );
  } catch {
    return false;
  }
}

export function stampPartnerBoostSubId(url: string, subId: string): string {
  if (!subId || !isPartnerBoostTrackUrl(url)) return url;
  if (/[?&]uid=/.test(url)) return url; // already stamped — leave as-is
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}uid=${encodeURIComponent(subId)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// CJ (Commission Junction) — Universal Deep Link (DLG) wrap.
//
// CJ has two deep-link surfaces:
//   - Classic LinkID: requires per-product registration in CJ's dashboard.
//     Cumbersome — not used.
//   - Universal Deep Link (DLG): works with ANY product URL on an approved
//     merchant's site. Format documented at
//     https://developers.cj.com/account/documentation/getting-started-with-deep-linking
//
// DLG URL shape:
//   https://www.anrdoezrs.net/links/{PID}/type/dlg/sid/{SID}/{ENCODED_TARGET}
// where:
//   PID = Promotional Property ID — we have two:
//         101740603 for iOS App (src=ios)
//         101761822 for Website (everything else)
//   SID = Shopper ID — arbitrary string up to 50 chars. We stamp it with
//         our click_event_id so cj_commissions.shopper_id → click_events.id
//         joins for commission reconciliation (see cj-commissions-sync EF).
//   ENCODED_TARGET = the original merchant URL, URL-encoded.
//
// Recognized post-wrap CJ hosts (so we can detect already-wrapped URLs and
// not double-wrap them): anrdoezrs.net, tkqlhce.com, dpbolvw.net, kqzyfj.com,
// jdoqocy.com, qksrv.net — these are CJ's click-server domains.
const CJ_WRAP_HOSTS = new Set([
  'anrdoezrs.net',
  'www.anrdoezrs.net',
  'tkqlhce.com',
  'www.tkqlhce.com',
  'dpbolvw.net',
  'www.dpbolvw.net',
  'kqzyfj.com',
  'www.kqzyfj.com',
  'jdoqocy.com',
  'www.jdoqocy.com',
  'qksrv.net',
  'www.qksrv.net',
]);

// Promotional Property IDs from CJ → Account → Promotional Properties.
// iOS gets the App PID so CJ's reporting can split mobile vs web attribution
// without us having to threading source through their dashboard.
const CJ_PID_IOS = '101740603'; // "Styled in Motion App"
const CJ_PID_WEB = '101761822'; // "Styled in Motion"

export function isCjWrappedUrl(url: string): boolean {
  try {
    return CJ_WRAP_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Pick the right Promotional Property for the click's source. iOS-originated
 * clicks (src=ios) get the App PID; everything else (web, external, null)
 * uses the Website PID. */
export function pickCjPid(source: string | null): string {
  return source === 'ios' ? CJ_PID_IOS : CJ_PID_WEB;
}

/** Build a CJ DLG deep link wrapping `targetUrl` for advertiser routing,
 * with `sid` stamped for per-click attribution. Pure function — no DB,
 * no network.
 *
 * NOTE: this is the `type/dlg` automated-deep-link format, which relies on
 * CJ's page-based JS deep-link automation to resolve the destination. It does
 * NOT attribute in a native in-app browser for advertisers without that
 * automation enabled. Prefer `buildCjClickLink` whenever the advertiser has a
 * `universal_link_ad_id`; this remains the fallback for advertisers that don't
 * (e.g. Coofandy, Rainbow Shops). */
export function buildCjDeepLink(targetUrl: string, pid: string, sid: string): string {
  const enc = encodeURIComponent(targetUrl);
  return `https://www.anrdoezrs.net/links/${pid}/type/dlg/sid/${encodeURIComponent(sid)}/${enc}`;
}

/** Build a CJ per-advertiser click link. Unlike `type/dlg`, this uses the
 * advertiser's ad id (`universal_link_ad_id`) directly, so it attributes in a
 * native in-app browser without relying on CJ's page-based deep-link
 * automation. `sid` (= click_event_id) flows through for commission
 * reconciliation, same as the DLG link. Pure function — no DB, no network. */
export function buildCjClickLink(targetUrl: string, pid: string, aid: string, sid: string): string {
  const url = encodeURIComponent(targetUrl);
  return `https://www.anrdoezrs.net/click-${pid}-${aid}?url=${url}&sid=${encodeURIComponent(sid)}`;
}

/** Extract a hostname (lowercased, no www.) suitable for matching against
 * affiliate_merchants.domain. */
function hostnameNoWww(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function extractAsin(url: string): string | null {
  const m = url.match(ASIN_PATH_RE) ?? url.match(ASIN_PARAM_RE);
  return m?.[1]?.toUpperCase() ?? null;
}

// Backstop traffic-source inference from the User-Agent, used ONLY when the
// client didn't pass an explicit ?source= param and there's no Referer to lean
// on. The explicit param is always authoritative — UA alone can't tell the iOS
// in-app browser apart from a mobile-web shopper (both are "iPhone … Safari"),
// so this exists purely to keep rows from landing null. Returns null for known
// bots / link-preview crawlers and unrecognized agents so server-to-server and
// scraper hits stay unattributed (and filterable) rather than mislabeled.
export function sourceFromUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const s = ua.toLowerCase();
  // Bots / link-preview crawlers / server fetchers first, so an Android- or
  // Safari-token-bearing bot UA doesn't get miscounted as a real shopper.
  if (/bot|crawler|spider|facebookexternalhit|slackbot|twitterbot|whatsapp|telegram|discordbot|embedly|preview|curl|wget|python-requests|node-fetch|axios|okhttp|go-http|headless/.test(s)) {
    return null;
  }
  // Mobile. The iOS app passes ?source=ios explicitly; this only catches
  // param-less mobile traffic. Android is split out (the future Android client
  // sends ?source=android) but both are "mobile app/web" for analytics.
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (/android/.test(s)) return 'android';
  // Desktop browsers → web (real browser engine token on a desktop platform).
  if (
    /(macintosh|mac os x|windows nt|x11|cros|\blinux\b)/.test(s) &&
    /(mozilla|applewebkit|gecko|chrome|safari|firefox|edg|opera|opr)/.test(s)
  ) {
    return 'web';
  }
  return null;
}

function domainFromUrl(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// 3-tier Amazon tag resolution. Mirrors the affiliate-wrap-url EF v8 so
// click-time stamping matches report-time reconciliation. Pure function
// so the unit tests can exercise tier precedence without touching Supabase.
//
// Tier 1 — own tag: creator opted into using their own Associates account.
//   Commissions go straight to them; SiM does not reconcile.
// Tier 2 — SiM per-creator subtag (creators.amazon_tracking_id): same parent
//   Associates account as master, but Amazon's dashboard groups clicks per
//   tag so the creator sees their own numbers in real time.
// Tier 3 — master tag: catch-all so we never ship an un-tagged Amazon URL
//   when a fallback exists.
export type AmazonTagSource = 'own' | 'creator_tracking_id' | 'master';
export function resolveAmazonTag(args: {
  ownTag: string | null | undefined;
  useOwnFlag: boolean;
  ownEnabledFlag: boolean;
  creatorTrackingId: string | null | undefined;
  masterTag: string | null | undefined;
}): { tag: string; source: AmazonTagSource } | null {
  const own = (args.ownTag ?? '').trim();
  if (args.useOwnFlag && args.ownEnabledFlag && own.length > 0) {
    return { tag: own, source: 'own' };
  }
  const subtag = (args.creatorTrackingId ?? '').trim();
  if (subtag.length > 0) {
    return { tag: subtag, source: 'creator_tracking_id' };
  }
  const master = (args.masterTag ?? '').trim();
  if (master.length > 0) {
    return { tag: master, source: 'master' };
  }
  return null;
}

export function buildAmazonSpecialLink(
  originalUrl: string,
  tag: string,
  ascsubtag?: string,
  kw?: string,
): string {
  try {
    const u = new URL(originalUrl);
    u.searchParams.set('tag', tag);
    if (ascsubtag) u.searchParams.set('ascsubtag', ascsubtag);
    if (kw) u.searchParams.set('kw', kw);
    return u.toString();
  } catch {
    return originalUrl;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Last-resort wrap for RAW merchant URLs that matched no inline network
// fast-path (Amazon / awin1 / linksynergy / inline-CJ all handled before this).
// Delegates to the affiliate-wrap-url Supabase Edge Function, which owns
// domain-matching + per-network deeplink building + subtag stamping for
// CJ / Rakuten / Awin / Amazon / PartnerBoost, keyed to the click_event_id we
// pass — so none of that credential logic lives here.
//
// Fully fail-soft: bounded to ~6s and returns null on timeout / error / no-match
// so the caller logs + 302s the raw URL instead of ever blocking or 5xx-ing the
// redirect. verify_jwt=false on the EF, so the project key is just the gateway
// apikey (we use the service-role key this function already holds).
interface AffiliateWrapResult {
  provider: string; // 'amazon' | 'cj' | 'rakuten' | 'awin' | 'partnerboost' | 'none'
  wrappedUrl: string;
}
async function wrapViaAffiliateEf(
  url: string,
  clickEventId: string,
  creatorId: string | null,
): Promise<AffiliateWrapResult | null> {
  const base = SUPABASE_URL;
  const key = SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${base}/functions/v1/affiliate-wrap-url`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, click_event_id: clickEventId, creator_id: creatorId }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    if (!body?.ok) return null;
    const provider = typeof body.provider === 'string' ? body.provider : 'none';
    const wrappedUrl =
      typeof body.wrapped_url === 'string' && body.wrapped_url.length > 0
        ? body.wrapped_url
        : url;
    return { provider, wrappedUrl };
  } catch {
    return null; // timeout / network / parse — fail soft, caller 302s raw
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // Accept HEAD alongside GET — Hono auto-serves HEAD for .get() routes, so
  // the legacy backend answered link-preview/health HEAD probes; match it.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);
  }

  const sp = new URL(req.url).searchParams;
  const lookId = sp.get('lookId');
  const itemId = sp.get('itemId');
  // Look-less entry params (Addition 2): a closet item not in a look
  // (creatorItemId) or a brand-catalog product URL (url, + optional creatorId).
  const creatorItemId = sp.get('creatorItemId');
  const urlParam = sp.get('url');
  const creatorIdParam = sp.get('creatorId') ?? null;

  // Request-metadata attribution (captured on every /api/shop hit). `source`
  // is resolved by a 3-step precedence — explicit param → Referer → User-Agent:
  //
  //   1. `source` (or legacy `src`) query param: the authoritative client tag.
  //      The iOS app sends ?source=ios; web sends ?source=web. Already-deployed
  //      app binaries still send ?src=ios, so we accept both names.
  //   2. Referer header: present for web/mobile-web shoppers (the look page or
  //      an IG redirector). The iOS in-app browser sends NO referer, so a
  //      referer reliably means "web" — this also keeps a param-less mobile-web
  //      shopper (iPhone Safari) from being mislabeled 'ios' by UA sniffing.
  //   3. User-Agent backstop (sourceFromUserAgent): only when there's neither a
  //      param nor a referer. iPhone UA ⇒ 'ios', desktop ⇒ 'web', bots ⇒ null.
  //
  // Net effect: explicit param is always trusted; everything else only fills in
  // to avoid leaving real shopper clicks null. True server-to-server / bot hits
  // (no param, no referer, bot/empty UA) correctly stay null.
  const srcRaw = sp.get('source') ?? sp.get('src');
  const referer = req.headers.get('referer') ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;
  // Allow-list: 'ios' (mobile), 'web' (shop.styledinmotion.studio), 'android'
  // (future), 'creator' (creators-web — a creator clicking from her own
  // dashboard so analytics can filter out self-traffic). Anything else is
  // ignored and inferred from referer / UA below.
  const explicitSource: string | null =
    srcRaw === 'ios' || srcRaw === 'web' || srcRaw === 'android' || srcRaw === 'creator'
      ? srcRaw
      : null;
  const source: string | null =
    explicitSource ?? (referer ? 'web' : sourceFromUserAgent(userAgent));

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json({ error: { message: 'Database unavailable', code: 'DB_UNAVAILABLE' } }, 503);
  }

  // ── Entry-mode resolution ───────────────────────────────────────────────
  // /api/shop accepts three shapes, all normalized to a common
  // (rawUrl, rawAffiliateUrl, item id, creator id, look id) tuple before the
  // shared per-network pipeline below:
  //   1. lookId + itemId            — a look item (original path, unchanged).
  //   2. creatorItemId              — a closet item not in any look (web search
  //                                   "direct-to-retailer"); logs look_id=null.
  //   3. url (+ optional creatorId) — a brand-catalog product (iOS Brands tab),
  //                                   not a creator_items row; logs look_id=null
  //                                   and item_id=null. Open-redirect guarded.
  let rawUrl: string;
  let rawAffiliateUrl: string | null = null;
  let resolvedItemId: string | null = null;    // → click_events.item_id
  let resolvedCreatorId: string | null = null;  // → click_events.creator_id
  let resolvedLookId: string | null = null;     // → click_events.look_id

  if (lookId && itemId) {
    // Left join on looks (not !inner) so an archived/modified look doesn't
    // block a click on a still-valid item. creator_id falls back to
    // creator_items.creator_id if the look row is gone.
    const { data: lookItem, error: liError } = await supabase
      .from('look_items')
      .select('id, creator_items(id, url, affiliate_url, creator_id), looks(id, creator_id)')
      .eq('id', itemId)
      .eq('look_id', lookId)
      .maybeSingle();

    if (liError || !lookItem || !(lookItem as any).creator_items?.url) {
      console.error('[shop-redirect] lookup miss', {
        liError: liError?.message,
        liCode: liError?.code,
        hasLookItem: !!lookItem,
        hasCreatorItems: !!(lookItem as any)?.creator_items,
        hasUrl: !!(lookItem as any)?.creator_items?.url,
        itemId,
        lookId,
      });
      return json({ error: { message: 'Item not found', code: 'NOT_FOUND' } }, 404);
    }

    rawUrl = (lookItem as any).creator_items.url;
    rawAffiliateUrl = (lookItem as any).creator_items.affiliate_url ?? null;
    resolvedItemId = (lookItem as any).creator_items.id;
    // Prefer look.creator_id; fall back to creator_items.creator_id for archived looks.
    resolvedCreatorId =
      (lookItem as any).looks?.creator_id ??
      (lookItem as any).creator_items?.creator_id ??
      null;
    resolvedLookId = lookId;
  } else if (creatorItemId) {
    // Closet item not in a look — resolve creator_items directly.
    const { data: ci, error: ciErr } = await supabase
      .from('creator_items')
      .select('id, url, affiliate_url, creator_id')
      .eq('id', creatorItemId)
      .maybeSingle();
    if (ciErr || !ci?.url) {
      return json({ error: { message: 'Item not found', code: 'NOT_FOUND' } }, 404);
    }
    rawUrl = ci.url as string;
    rawAffiliateUrl = (ci.affiliate_url as string | null) ?? null;
    resolvedItemId = ci.id as string;
    resolvedCreatorId = (ci.creator_id as string | null) ?? null;
    resolvedLookId = null;
  } else if (urlParam) {
    // Brand-catalog product (not a creator_items row). Open-redirect guard:
    // only 302 a ?url= whose host is an Amazon host OR an ACTIVE
    // affiliate_merchants row — never blind-redirect an arbitrary URL.
    // Amazon is special-cased because it is NOT an affiliate_merchants row
    // (it's handled via isAmazonHost + per-creator tag/ascsubtag, not the
    // awin/cj/rakuten merchant union). Amazon hosts are always ours, so the
    // ?url= is safe; downstream isAmazonHost stamps the tag correctly.
    // Brand-catalog products are always our merchants, so real taps pass;
    // this just blocks abuse.
    const host = hostnameNoWww(urlParam);
    if (!host) {
      return json({ error: { message: 'Invalid url', code: 'VALIDATION_ERROR' } }, 400);
    }
    if (!isAmazonHost(urlParam)) {
      const { data: merchant } = await supabase
        .from('affiliate_merchants')
        .select('id')
        .eq('status', 'active')
        .or(`domain.eq.${host},alt_domains.cs.{${host}}`)
        .limit(1)
        .maybeSingle();
      if (!merchant) {
        return json(
          { error: { message: 'url host is not a known merchant', code: 'UNKNOWN_MERCHANT' } },
          400,
        );
      }
    }
    rawUrl = urlParam;
    rawAffiliateUrl = null;
    resolvedItemId = null;
    resolvedCreatorId = creatorIdParam;
    resolvedLookId = null;
  } else {
    return json(
      {
        error: {
          message: 'Provide lookId+itemId, creatorItemId, or url',
          code: 'VALIDATION_ERROR',
        },
      },
      400,
    );
  }

  // Resolve which URL to use. Amazon wins (50+ live click_events depend on
  // this), then Awin. If neither column matches a recognized network we
  // fall back to the raw url. We do NOT prefer affiliate_url blindly —
  // Macy's etc. should never override the canonical url.
  const itemUrl: string =
    rawAffiliateUrl && isAmazonHost(rawAffiliateUrl)  ? rawAffiliateUrl :
    isAmazonHost(rawUrl)                              ? rawUrl :
    rawAffiliateUrl && isAwinUrl(rawAffiliateUrl)     ? rawAffiliateUrl :
    isAwinUrl(rawUrl)                                  ? rawUrl :
    rawAffiliateUrl && isRakutenUrl(rawAffiliateUrl)  ? rawAffiliateUrl :
    isRakutenUrl(rawUrl)                               ? rawUrl :
    rawUrl;

  const amazon = isAmazonHost(itemUrl);
  // Amazon wins if a URL hypothetically matched both networks.
  const awin = !amazon && isAwinUrl(itemUrl);
  // Rakuten (linksynergy) — ALREADY-wrapped deep link in the URL. Checked after
  // Amazon/Awin, before CJ. The raw-merchant case (bare brand URL) is handled
  // by the rakuten_merchants lookup just below.
  const rakuten = !amazon && !awin && isRakutenUrl(itemUrl);

  // Raw-merchant Rakuten: itemUrl is a bare brand URL (e.g. lamarquecollection.com)
  // whose host matches an ACTIVE rakuten merchant (affiliate_merchants view,
  // network='rakuten'). Previously these 302'd to the raw store URL and earned
  // nothing — only product URLs the affiliate-wrap-url EF happened to wrap got a
  // linksynergy deeplink. We now build the deeplink inline for EVERY Rakuten click
  // (homepage / brand-level included), keyed to rakuten_mid. Mirrors the CJ lookup.
  let rakutenMid: string | null = null;
  let rakutenMerchantHome: string | null = null;   // click_through_url (murl fallback)
  let rakutenMerchantDomainMatch: string | null = null;
  if (!amazon && !awin && !rakuten) {
    const host = hostnameNoWww(itemUrl);
    if (host) {
      const { data: rm, error: rmErr } = await supabase
        .from('affiliate_merchants')
        .select('rakuten_mid, domain, click_through_url')
        .eq('network', 'rakuten')
        .eq('status', 'active')
        .or(`domain.eq.${host},alt_domains.cs.{${host}}`)
        .limit(1)
        .maybeSingle();
      if (rmErr) {
        // Log loudly (mirrors the click_events insert below) — a swallowed
        // PostgREST error here nulls rm and silently leaks the Rakuten click.
        console.error('[shop-redirect] Rakuten merchant lookup failed', {
          code: (rmErr as any).code,
          message: rmErr.message,
          details: (rmErr as any).details,
          host,
          itemUrl,
        });
      }
      if (rm?.rakuten_mid) {
        rakutenMid = String(rm.rakuten_mid);
        rakutenMerchantHome = (rm.click_through_url as string | null) ?? null;
        rakutenMerchantDomainMatch = (rm.domain as string | null) ?? host;
      }
    }
  }
  const rakutenRaw = !!rakutenMid;

  // CJ check happens AFTER Amazon/Awin so a hypothetical raw URL hitting an
  // Amazon-affiliated merchant via CJ would still resolve to Amazon (correct —
  // Amazon's commission is higher and the tag chain is per-creator). CJ only
  // applies to raw merchant URLs where the host matches an active CJ
  // merchant in affiliate_merchants. Already-CJ-wrapped URLs
  // (anrdoezrs.net/etc.) short-circuit the lookup since the click was wrapped
  // by some upstream system (rare today — added for forward-compat).
  let cjAdvertiserId: string | null = null;
  let cjMerchantDomain: string | null = null;
  // The advertiser's CJ ad id, used to build the per-advertiser `click-PID-AID`
  // link. Null for advertisers without one (e.g. Coofandy, Rainbow Shops) →
  // those fall back to the `type/dlg` DPL link.
  let cjAdId: string | null = null;
  const cjAlreadyWrapped = !amazon && !awin && !rakuten && !rakutenRaw && isCjWrappedUrl(itemUrl);
  if (!amazon && !awin && !rakuten && !rakutenRaw && !cjAlreadyWrapped) {
    const host = hostnameNoWww(itemUrl);
    if (host) {
      // Match by primary `domain` OR by membership in `alt_domains` (some
      // brands like CAMPER use camper.com/us, camper.com/ca etc. as alts).
      // ilike on `domain` covers the common case; the alt_domains check is
      // OR'd via `cs` (contains) on the text[] column.
      // NOTE: the ad-id column (universal_link_ad_id) is NOT exposed on the
      // live affiliate_merchants view — SELECTing it makes PostgREST return a
      // 42703 "column does not exist" error, which silently nulls cjMerchant
      // and leaks EVERY CJ click. So we only select columns that exist; cjAdId
      // therefore always resolves to null → the `type/dlg` fallback link is
      // built (see buildCjDeepLink below). Exposing the ad-id column on the
      // view (a separate migration) would let the stronger click-PID-AID link
      // via buildCjClickLink light up — that branch is kept intact for then.
      const { data: cjMerchant, error: cjErr } = await supabase
        .from('affiliate_merchants')
        .select('cj_advertiser_id, domain')
        .eq('network', 'cj')
        .eq('status', 'active')
        .or(`domain.eq.${host},alt_domains.cs.{${host}}`)
        .limit(1)
        .maybeSingle();
      if (cjErr) {
        // Log loudly (mirrors the click_events insert below) — a swallowed
        // PostgREST error here nulls cjMerchant and silently leaks the click.
        console.error('[shop-redirect] CJ merchant lookup failed', {
          code: (cjErr as any).code,
          message: cjErr.message,
          details: (cjErr as any).details,
          host,
          itemUrl,
        });
      }
      if (cjMerchant?.cj_advertiser_id) {
        cjAdvertiserId = cjMerchant.cj_advertiser_id as string;
        cjMerchantDomain = (cjMerchant.domain as string) ?? host;
        // No ad-id column on the view → always null → buildCjDeepLink fallback.
        cjAdId = null;
      }
    }
  }
  const cj = !!cjAdvertiserId;

  // Decide tag strategy upfront so we can record affiliation on the
  // click_events row at insert time. 3-tier (see resolveAmazonTag):
  // own → creators.amazon_tracking_id (SiM subtag) → master.
  let amazonTag: string | null = null;
  let amazonTagSource: AmazonTagSource | null = null;

  if (amazon) {
    let profile: any = null;
    let creator: any = null;
    // Per-creator tag tiers only apply when we know the creator (look / closet
    // items). Brand-catalog taps may have no creator → fall straight to the
    // master tag. Guarding the reads also avoids a `creator_id=eq.null` query.
    if (resolvedCreatorId) {
      // Both reads are independent — parallelize to keep redirect latency tight.
      const [profileRes, creatorRes] = await Promise.all([
        supabase
          .from('creator_profiles')
          .select('amazon_associates_tag, amazon_use_own_tag, amazon_own_tag_enabled')
          .eq('creator_id', resolvedCreatorId)
          .maybeSingle(),
        supabase
          .from('creators')
          .select('amazon_tracking_id')
          .eq('id', resolvedCreatorId)
          .maybeSingle(),
      ]);
      profile = profileRes.data;
      creator = creatorRes.data;
    }

    const resolved = resolveAmazonTag({
      ownTag: profile?.amazon_associates_tag,
      useOwnFlag: profile?.amazon_use_own_tag === true,
      ownEnabledFlag: profile?.amazon_own_tag_enabled === true,
      creatorTrackingId: creator?.amazon_tracking_id,
      masterTag: AMAZON_PLATFORM_ASSOCIATES_TAG,
    });
    if (resolved) {
      amazonTag = resolved.tag;
      amazonTagSource = resolved.source;
    }
  }

  // Pre-generate the click_events id so we can use it as ascsubtag in
  // the SiM-controlled tag URLs AND store the final redirect_url on the
  // same row — single INSERT for both attribution and audit.
  const clickEventId = crypto.randomUUID();

  // Sponsored Products: look up active campaign by ASIN and append kw= if set.
  let campaignKw: string | undefined;
  if (amazon && amazonTag) {
    const asin = extractAsin(itemUrl);
    if (asin) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('kw')
        .contains('asins', [asin])
        .lte('start_date', today)
        .gte('end_date', today)
        .is('archived_at', null)
        .eq('campaign_type', 'sponsored_products')
        .not('kw', 'is', null)
        .order('commission_rate_pct', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (campaign?.kw) campaignKw = campaign.kw as string;
    }
  }

  let redirectUrl = itemUrl;
  let awinMerchantDomain: string | null = null;
  let rakutenMerchantDomain: string | null = null;
  // Set when the raw-fallback EF wrapped the URL (provider !== 'none'). Drives
  // affiliate_network / was_affiliated for items with no inline network match.
  let efProvider: string | null = null;
  if (amazon) {
    if (amazonTag) {
      // ascsubtag is only meaningful for SiM-controlled tag accounts (master
      // + per-creator subtags share one Associates parent, reconciled via
      // click_event_id at report time). Own-tag clicks land in the creator's
      // own Associates account where our click_event_id is noise.
      const ascsubtag = amazonTagSource === 'own' ? undefined : clickEventId;
      redirectUrl = buildAmazonSpecialLink(itemUrl, amazonTag, ascsubtag, campaignKw);
    }
    // else: un-tagged Amazon URL (no commission earned; master env unset)
  } else if (awin) {
    // Awin URLs already carry awinaffid (publisher credit). We just need
    // to stamp the current creator's clickref onto the outbound URL so
    // Awin's reporting attributes the commission back to this creator.
    // creators table has no slug column today, so we use creators.id
    // (UUID). Awin accepts any string up to 100 chars. Empty when a creatorless
    // brand-catalog tap somehow lands here (no attribution, but never crashes).
    const creatorSlug = resolvedCreatorId ?? '';
    redirectUrl = rewriteAwinUrl(itemUrl, creatorSlug);
    awinMerchantDomain = extractAwinMerchantDomain(itemUrl);
  } else if (rakuten) {
    // Rakuten deep links already carry the publisher credit (id/mid). Stamp
    // u1=<click_event_id> so the commission postback (which echoes u1)
    // reconciles back to this exact click_events row — the Rakuten analogue of
    // Awin clickref / Amazon ascsubtag. id/mid/murl are left untouched.
    redirectUrl = rewriteRakutenUrl(itemUrl, clickEventId);
    rakutenMerchantDomain = extractRakutenMerchantDomain(itemUrl);
  } else if (rakutenRaw && RAKUTEN_PUBLISHER_ID) {
    // Raw brand URL matched a Rakuten merchant — build the linksynergy deeplink
    // inline so the click attributes (id/mid = publisher credit, u1 = this
    // click_event_id). murl = the product URL we're sending the shopper to; fall
    // back to the merchant's stored homepage only if itemUrl is somehow empty.
    // NOTE: RAKUTEN_PUBLISHER_ID is unset in production (matching the legacy
    // backend), so this branch is dormant — raw Rakuten clicks take the
    // wrapViaAffiliateEf fallback below, which reads rakuten_publisher_config.
    const murlTarget = itemUrl || rakutenMerchantHome || itemUrl;
    redirectUrl = buildRakutenDeepLink(
      murlTarget,
      RAKUTEN_PUBLISHER_ID,
      rakutenMid!,
      clickEventId,
    );
    rakutenMerchantDomain = rakutenMerchantDomainMatch ?? domainFromUrl(itemUrl);
  } else if (cj) {
    // CJ wrap. sid = our click_event_id flows through CJ → the
    // cj-commissions-sync edge function pulls commission records where
    // shopperId === sid, so we can reconcile every CJ commission back to a
    // specific click_events row (and therefore creator + look + item).
    // PID is picked by traffic source — iOS gets the App PID so CJ's
    // dashboard can split mobile vs web without us threading it manually.
    //
    // Prefer the per-advertiser `click-PID-AID` format when we have the
    // advertiser's ad id — it attributes in a native in-app browser. The
    // `type/dlg` DPL link relies on CJ's page-based JS deep-link automation
    // and does NOT attribute in-app, so it's only the fallback for advertisers
    // without a `universal_link_ad_id` (e.g. Coofandy, Rainbow Shops).
    const pid = pickCjPid(source);
    redirectUrl = cjAdId
      ? buildCjClickLink(itemUrl, pid, cjAdId, clickEventId)
      : buildCjDeepLink(itemUrl, pid, clickEventId);
  } else {
    // Raw fallback — itemUrl matched no inline network fast-path. Delegate to
    // the affiliate-wrap-url EF, which domain-matches + builds a CJ/Rakuten/
    // Awin/Amazon/PartnerBoost deeplink keyed to clickEventId. This is what
    // recovers a raw coutr.com / verabradley.com URL (no affiliate_url) as a
    // commissionable Rakuten link. Fail-soft: timeout/error/none → 302 raw.
    const wrap = await wrapViaAffiliateEf(itemUrl, clickEventId, resolvedCreatorId);
    if (wrap && wrap.provider !== 'none' && wrap.wrappedUrl) {
      redirectUrl = wrap.wrappedUrl;
      efProvider = wrap.provider;
    }
    // else: provider 'none' / EF down → redirectUrl stays itemUrl (log + 302 raw)
  }

  // PartnerBoost attribution — append our click_event_id as PartnerBoost's
  // sub-id. Works whether the track link came straight from the item URL or was
  // built by the affiliate-wrap-url EF above; without it, partnerboost-
  // transactions-sync lands DTC/Walmart conversions with a null creator. No-op
  // for every other network (the other branches don't produce partnerboost.com
  // links), and the stamped URL is what we persist as redirect_url below.
  redirectUrl = stampPartnerBoostSubId(redirectUrl, clickEventId);

  // Authoritative network labels derived from the FINAL redirect URL (same basis
  // as the click_events DB trigger's domain inference). This captures the
  // inline-built Rakuten deeplink and any PartnerBoost track link that the inline
  // network booleans (which look at itemUrl) don't — and guarantees we NEVER
  // default an unmatched click to 'awin'. A PartnerBoost redirect is labeled
  // 'partnerboost'; everything else without an inline match records its real EF
  // provider or stays null (the trigger fills it from the redirect domain).
  const redirectIsRakuten = rakuten || isRakutenUrl(redirectUrl);
  const redirectIsPartnerBoost = isPartnerBoostTrackUrl(redirectUrl);

  const { error: clickErr } = await supabase
    .from('click_events')
    .insert({
      id: clickEventId,
      look_id: resolvedLookId,
      item_id: resolvedItemId,
      item_url: itemUrl,
      redirect_url: redirectUrl,
      creator_id: resolvedCreatorId,
      was_affiliated:
        !!amazonTag || awin || redirectIsRakuten || cj || redirectIsPartnerBoost || !!efProvider,
      affiliate_network: amazon
        ? 'amazon'
        : awin
          ? 'awin'
          : redirectIsRakuten
            ? 'rakuten'
            : cj
              ? 'cj'
              : redirectIsPartnerBoost
                ? 'partnerboost'
                : efProvider, // EF-resolved provider (rakuten/cj/awin/amazon/partnerboost) or null — never 'awin' by default
      // Which Amazon tier actually got stamped on the outbound URL. NULL for
      // non-Amazon clicks. Persisted at click time (not derived after the fact)
      // so tag changes in the future can't rewrite history.
      amazon_tag_source: amazonTagSource,
      // CJ advertiser id (canonical FK on the commission side). NULL for
      // non-CJ clicks. Powers the reconciliation join against
      // cj_commissions.advertiser_id when surfacing per-advertiser earnings.
      cj_advertiser_id: cjAdvertiserId,
      merchant_domain: amazon
        ? 'amazon.com'
        : awin
          ? (awinMerchantDomain ?? domainFromUrl(itemUrl))
          : redirectIsRakuten
            ? (rakutenMerchantDomain ?? domainFromUrl(itemUrl))
            : cj
              ? (cjMerchantDomain ?? domainFromUrl(itemUrl))
              : domainFromUrl(itemUrl),
      source,
      referer,
      user_agent: userAgent,
      // Adoption marker for the Vibecode decommission gate: rows written by
      // this edge function say 'edge'; rows from the legacy Hono backend stay
      // NULL. When NULL rows stop arriving, old app builds have drained and
      // meadow-grindstone can be turned off.
      served_by: 'edge',
    });

  if (clickErr) {
    // Log loudly (error, with the Postgres code) — a silent INSERT drop here
    // still 302s, so without this a failing click_events write looks like a
    // redirect that "worked" (see the brand-catalog ?url= context-check drop).
    console.error('[shop-redirect] click_events insert failed', {
      code: (clickErr as any).code,
      message: clickErr.message,
      details: (clickErr as any).details,
      look_id: resolvedLookId,
      item_id: resolvedItemId,
      merchant_domain: amazon ? 'amazon.com' : domainFromUrl(itemUrl),
    });
  }

  return new Response(null, {
    status: 302,
    headers: { ...CORS, Location: redirectUrl },
  });
});
