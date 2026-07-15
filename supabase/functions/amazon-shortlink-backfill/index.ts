// amazon-shortlink-backfill — canonicalizes Amazon SHORT LINKS
// (amzn.to / a.co / amzn.eu / amzn.asia) that were stored in creator_items.url
// but never got an affiliate_url. On a "Shop" tap, shop-redirect falls back to
// the raw short link, which produces two failure modes:
//   1. Well-formed short link → resolves to the real product, but the tag we
//      append to the amzn.to url is dropped by the shortener's own redirect, so
//      the creator's EMBEDDED Amazon tag wins → commission attribution leaks to
//      the creator's own Associates account instead of the SiM master/sub-tag.
//   2. MALFORMED short link (e.g. a stray trailing char) → the shortener
//      dead-ends on the Amazon HOMEPAGE / a search page → the shopper never
//      reaches the product.
//
// Fix per item — GET the short link (redirect:'follow'), take the FINAL url,
// extractAsin:
//   • ASIN found  → rewrite `url` to the canonical https://www.amazon.com/dp/<ASIN>
//                   and set `affiliate_url` to that dp url + the creator's
//                   resolved tag. shop-redirect re-stamps the tag PER CLICK, so
//                   the canonical /dp/ url (a real amazon.com host, no shortener
//                   hop to strip our tag) is what actually stops the leak.
//   • no ASIN     → the short link is dead/malformed (homepage/search). DO NOT
//                   guess a product. Flag the item (attributes.link_health) so
//                   the creator can be prompted to re-add it, and surface it in
//                   the response for a manual nudge.
//   • unresolved  → transient (timeout / non-200). Left untouched for a re-run.
//
// Modeled on affiliate-image-backfill (CONCURRENCY 2 + 350ms/item — Amazon
// rate-limits bursts) and reuses auto-tag-amazon v15's shortlink + ASIN + tag
// logic VERBATIM, so a click through a backfilled item attributes exactly like
// a freshly-tagged one. Idempotent + additive: only ever fills a null
// affiliate_url; never rewrites an item that already has one.
//
//   POST { limit?, dry_run?, ids? }
//     limit   — max items this run (default 100, max 500)
//     dry_run — resolve + report the split but write NOTHING (default false)
//     ids     — optional explicit creator_items.id[] for targeted re-runs
//   → { data: { candidates, fixable, needs_readd, unresolved, skipped_non_shortlink,
//               dry_run, sample, needs_readd_items } }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Master fallback tag — same env auto-tag-amazon reads (styledinmotio-20).
const MASTER_TAG = Deno.env.get("AMAZON_ASSOCIATES_TAG") ?? "styledinmotio-20";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const CONCURRENCY = 2;          // gentle — Amazon rate-limits short-link bursts
const PER_ITEM_DELAY_MS = 350;
const SHORTLINK_TIMEOUT_MS = 8000; // a touch above auto-tag-amazon's 5s: this is
                                   // a batch job, so we favor resolving over speed.

// ── verbatim from auto-tag-amazon v15 ───────────────────────────────────────
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Host match is EXACT (hostname equality), never a substring: a `%a.co%` LIKE
// also matches zara.com / aritzia.com / aloyoga.com / mytheresa.com etc., which
// are NOT Amazon. The over-broad LIKE is why the original audit counted ~94
// "candidates" when only ~14 are real short links.
const SHORTLINK_HOSTS = new Set(["a.co", "amzn.to", "amzn.eu", "amzn.asia"]);
const ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/ASIN\/)([A-Z0-9]{10})(?:[\/?\s]|$)/i;

function shortlinkHost(rawUrl: string): string | null {
  try {
    const h = new URL(rawUrl).hostname.toLowerCase();
    return SHORTLINK_HOSTS.has(h) ? h : null;
  } catch {
    return null;
  }
}
function extractAsin(url: string): string | null {
  const match = url.match(ASIN_RE);
  return match ? match[1].toUpperCase() : null;
}
async function resolveShortlink(shortUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHORTLINK_TIMEOUT_MS);
  try {
    const res = await fetch(shortUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_UA, "Accept": "text/html" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return res.url;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// 3-tier tag resolution — verbatim precedence from auto-tag-amazon v15 /
// shop-redirect's resolveAmazonTag, so click-time stamping matches: (1) creator's
// own Associates account, (2) per-creator SiM sub-tag, (3) master.
async function resolveCreatorAmazonTag(
  supa: SupabaseClient,
  creatorId: string | null,
): Promise<{ tag: string; source: "own" | "creator_tracking_id" | "master" | "master_no_creator" }> {
  if (!creatorId) return { tag: MASTER_TAG, source: "master_no_creator" };
  const { data: prof } = await supa.from("creator_profiles")
    .select("amazon_use_own_tag, amazon_own_tag_enabled, amazon_associates_tag")
    .eq("creator_id", creatorId).maybeSingle();
  if (
    prof?.amazon_use_own_tag === true &&
    prof?.amazon_own_tag_enabled === true &&
    typeof prof?.amazon_associates_tag === "string" &&
    prof.amazon_associates_tag.trim().length > 0
  ) {
    return { tag: prof.amazon_associates_tag.trim(), source: "own" };
  }
  const { data: c } = await supa.from("creators")
    .select("amazon_tracking_id").eq("id", creatorId).maybeSingle();
  if (typeof c?.amazon_tracking_id === "string" && c.amazon_tracking_id.trim().length > 0) {
    return { tag: c.amazon_tracking_id.trim(), source: "creator_tracking_id" };
  }
  return { tag: MASTER_TAG, source: "master" };
}

type Row = {
  id: string;
  name: string | null;
  url: string;
  creator_id: string | null;
  affiliate_url: string | null;
  attributes: Record<string, unknown> | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: { message: "Method not allowed", code: "METHOD_NOT_ALLOWED" } }, 405);

  let body: { limit?: number; dry_run?: boolean; ids?: string[] } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const limit = Math.min(Math.max(body.limit ?? 100, 1), 500);
  const dryRun = body.dry_run === true;
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : null;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Candidates: un-wrapped (affiliate_url IS NULL), not archived, url host is an
  // Amazon short link. The four anchored ilike patterns ('//host/') keep the DB
  // scan tight; the authoritative filter is the EXACT-hostname check below, so
  // an over-match here (e.g. a path that merely contains '//a.co/') is dropped.
  let q = supa.from("creator_items")
    .select("id, name, url, creator_id, affiliate_url, attributes")
    .eq("archived", false)
    .is("affiliate_url", null);
  if (ids && ids.length) {
    q = q.in("id", ids);
  } else {
    q = q.or(
      "url.ilike.*//amzn.to/*,url.ilike.*//a.co/*,url.ilike.*//amzn.eu/*,url.ilike.*//amzn.asia/*",
    ).limit(limit);
  }
  const { data: rows, error } = await q;
  if (error) return jsonRes({ error: { message: error.message, code: "QUERY_FAILED" } }, 500);

  // Exact-host filter — the real gate. Anything that slipped through the LIKE
  // (or an `ids` row that isn't actually a short link) is counted + skipped.
  const all = (rows ?? []) as Row[];
  const candidates = all.filter((r) => r.url && shortlinkHost(r.url));
  const skippedNonShortlink = all.length - candidates.length;

  let fixable = 0;
  let needsReadd = 0;
  let unresolved = 0;
  const sample: Array<{ id: string; from: string; to: string; tag_source: string }> = [];
  const needsReaddItems: Array<{ id: string; name: string | null; creator_id: string | null; final_url: string }> = [];

  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const row = candidates[cursor++];
      await new Promise((r) => setTimeout(r, PER_ITEM_DELAY_MS));

      const finalUrl = await resolveShortlink(row.url);
      if (!finalUrl) { unresolved++; continue; }            // transient — retry later

      const asin = extractAsin(finalUrl);
      if (!asin) {
        // Dead / malformed short link → homepage or search. Never guess a
        // product; flag for creator re-add and report it.
        needsReadd++;
        needsReaddItems.push({ id: row.id, name: row.name, creator_id: row.creator_id, final_url: finalUrl });
        if (!dryRun) {
          const attrs = (row.attributes && typeof row.attributes === "object") ? row.attributes : {};
          await supa.from("creator_items").update({
            attributes: {
              ...attrs,
              link_health: {
                status: "needs_readd",
                reason: "amazon_shortlink_no_asin",
                short_url: row.url,
                final_url: finalUrl,
                checked_at: new Date().toISOString(),
              },
            },
          }).eq("id", row.id);
        }
        continue;
      }

      // FIXABLE — canonicalize url + wrap affiliate_url with the creator's tag.
      const canonicalUrl = `https://www.amazon.com/dp/${asin}`;
      const { tag, source } = await resolveCreatorAmazonTag(supa, row.creator_id);
      const affiliateUrl = `${canonicalUrl}?tag=${tag}`;
      fixable++;
      if (sample.length < 8) sample.push({ id: row.id, from: row.url, to: affiliateUrl, tag_source: source });

      if (!dryRun) {
        await supa.from("creator_items").update({
          url: canonicalUrl,
          affiliate_url: affiliateUrl,
          affiliate_provider: "amazon",
          affiliate_wrapped_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length || 1) }, () => worker()));

  return jsonRes({
    data: {
      candidates: candidates.length,
      fixable,
      needs_readd: needsReadd,
      unresolved,
      skipped_non_shortlink: skippedNonShortlink,
      dry_run: dryRun,
      sample,
      needs_readd_items: needsReaddItems,
    },
  });
});
