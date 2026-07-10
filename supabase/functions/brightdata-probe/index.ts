// brightdata-probe — one-off diagnostic for the Web Unlocker pilot.
// Calls Bright Data Web Unlocker with a long (default 110s) ceiling and
// logs status + true latency + byte size + <title> to metadata_fetch_logs
// as source='bd_probe'. Key stays in Supabase secrets; never leaves.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KEY = Deno.env.get("BRIGHTDATA_API_KEY") ?? "";
const ZONE = Deno.env.get("BRIGHTDATA_UNLOCKER_ZONE") ?? "cli_unlocker";

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const url: string = body.url;
  const timeout: number = body.timeout_ms ?? 110000;
  if (!url) return json({ error: "url_required" }, 400);
  if (!KEY) return json({ error: "no_BRIGHTDATA_API_KEY_secret" }, 500);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  let domain = "";
  try { domain = new URL(url).hostname.toLowerCase(); } catch { /* */ }

  const t0 = Date.now();
  let status = 0, ok = false, bytes = 0, title = "", ogImg = false;
  let err: string | null = null;
  try {
    const res = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone: ZONE, url, format: "raw" }),
      signal: AbortSignal.timeout(timeout),
    });
    status = res.status;
    const text = await res.text();
    bytes = text.length;
    title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim().slice(0, 120);
    ogImg = /property=["']og:image/i.test(text);
    ok = res.ok && bytes > 1000;
  } catch (e) {
    err = (e as Error).message;
  }
  const ms = Date.now() - t0;

  await supa.from("metadata_fetch_logs").insert({
    creator_id: null, url, domain, source: "bd_probe", source_order: 1,
    http_status: status || null, latency_ms: ms, ok, fields_count: ogImg ? 2 : 0,
    field_flags: { bytes, has_og_image: ogImg, title_len: title.length },
    parser_path: "probe", is_final: false,
    error_message: err ?? (title ? `title=${title}` : null),
  });

  return json({ ok, status, ms, bytes, title, has_og_image: ogImg, err });
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}
