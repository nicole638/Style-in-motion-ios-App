// brand-logos-backfill v2 — upgrades low-quality/missing brand logos. Targets
// rows whose logo_url is NULL or an icon.horse favicon (the 'blown out' ones),
// replacing with the best VALIDATED logo. Clearbit is DEAD (2026) so the chain
// is: Bright Data apple-touch-icon scrape → Google favicon sz=128. Leaves good
// network-CDN logos untouched. Parallel batches to fit the function window.
//
// Body: { mode:'test'|'run', tables?:string[], limit?:int, batch?:int, dry_run?:bool, include_suspect?:bool }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIGHTDATA_API_KEY = Deno.env.get("BRIGHTDATA_API_KEY") ?? "";
const BRIGHTDATA_UNLOCKER_ZONE = Deno.env.get("BRIGHTDATA_UNLOCKER_ZONE") ?? "cli_unlocker";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const ALL_TABLES = ["cj_merchants", "rakuten_merchants", "partnerboost_merchants", "awin_merchants"];
const MIN_IMAGE_BYTES = 1500;

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
function gfav(d: string) { return `https://www.google.com/s2/favicons?domain=${d}&sz=128`; }
function normDomain(d: string | null): string | null { if (!d) return null; return d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim() || null; }

async function validateImage(url: string): Promise<{ ok: boolean; bytes?: number }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000), redirect: "follow" });
    const ct = r.headers.get("content-type") || "";
    let bytes = parseInt(r.headers.get("content-length") || "0", 10);
    if (r.ok && !bytes) { try { bytes = (await r.arrayBuffer()).byteLength; } catch { /* */ } }
    return { ok: r.ok && ct.startsWith("image") && bytes >= MIN_IMAGE_BYTES, bytes };
  } catch { return { ok: false }; }
}

async function brightTouchIcon(domain: string): Promise<string | null> {
  if (!BRIGHTDATA_API_KEY) return null;
  try {
    const r = await fetch("https://api.brightdata.com/request", { method: "POST", headers: { "Authorization": `Bearer ${BRIGHTDATA_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ zone: BRIGHTDATA_UNLOCKER_ZONE, url: `https://${domain}/`, format: "raw" }), signal: AbortSignal.timeout(22000) });
    if (!r.ok) return null;
    const html = await r.text();
    const links = [...html.matchAll(/<link[^>]+apple-touch-icon[^>]*>/gi)].map((m) => m[0]);
    let best: string | null = null, bestSize = -1;
    for (const l of links) { const href = l.match(/href=["']([^"']+)["']/i)?.[1]; if (!href) continue; const sz = parseInt(l.match(/sizes=["'](\d+)/i)?.[1] || "0", 10); if (sz > bestSize) { best = href; bestSize = sz; } }
    if (!best) best = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1] ?? null;
    if (!best) return null;
    return new URL(best, `https://${domain}/`).href;
  } catch { return null; }
}

async function resolveBest(domain: string): Promise<{ url: string | null; via: string }> {
  const ti = await brightTouchIcon(domain);
  if (ti) { const tv = await validateImage(ti); if (tv.ok) return { url: ti, via: "brightdata" }; }
  const gf = gfav(domain); const gv = await validateImage(gf);
  if (gv.ok) return { url: gf, via: "gfavicon" };
  return { url: null, via: "none" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const mode = body.mode ?? "run";

  if (mode === "test") {
    const domains: string[] = body.domains ?? ["amiclubwear.com", "desigual.com"];
    const out: any[] = [];
    for (const d of domains) { const ti = await brightTouchIcon(d); out.push({ domain: d, brightdata_url: ti, brightdata_valid: ti ? (await validateImage(ti)).ok : false, gfav: await validateImage(gfav(d)) }); }
    return json({ mode, has_brightdata: !!BRIGHTDATA_API_KEY, results: out });
  }

  const tables: string[] = Array.isArray(body.tables) && body.tables.length ? body.tables.filter((t: string) => ALL_TABLES.includes(t)) : ALL_TABLES;
  const limit = Math.min(60, Math.max(1, parseInt(String(body.limit ?? 30), 10) || 30));
  const batchSize = Math.min(8, Math.max(1, parseInt(String(body.batch ?? 5), 10) || 5));
  const dryRun = body.dry_run === true;
  const includeSuspect = body.include_suspect === true;

  const perTable: any[] = [];
  for (const table of tables) {
    const { data: rows, error } = await supabase.from(table).select("id, domain, logo_url").is("archived_at", null);
    if (error) { perTable.push({ table, error: error.message.slice(0, 120) }); continue; }
    const targets = (rows ?? []).filter((r: any) => {
      if (!r.domain) return false;
      const l: string | null = r.logo_url;
      if (!l) return true;
      if (/icon\.horse/i.test(l)) return true;
      if (includeSuspect && /merchant\.linksynergy\.com\/fs\/logo\/lg_\d+$/i.test(l)) return true;
      return false;
    }).slice(0, limit);

    let updated = 0; const via: Record<string, number> = {}; const samples: any[] = [];
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (r: any) => { const domain = normDomain(r.domain); if (!domain) return null; const best = await resolveBest(domain); return { id: r.id, domain, best }; }));
      for (const x of results) {
        if (!x) continue;
        via[x.best.via] = (via[x.best.via] ?? 0) + 1;
        if (samples.length < 4) samples.push({ domain: x.domain, via: x.best.via });
        if (x.best.url && !dryRun) { const { error: upErr } = await supabase.from(table).update({ logo_url: x.best.url, updated_at: new Date().toISOString() }).eq("id", x.id); if (!upErr) updated++; }
        else if (x.best.url) updated++;
      }
    }
    perTable.push({ table, candidates: targets.length, updated, via, samples });
  }
  return json({ mode: "run", dry_run: dryRun, per_table: perTable });
});
