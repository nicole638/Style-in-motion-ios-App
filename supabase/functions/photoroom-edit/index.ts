// photoroom-edit — shared Photoroom proxy for VTO + selfie bg swap.
// Modes:
//   'vto'        → garment_url + selfie_url, paper-doll output (no scene)
//   'remove_bg'  → source_url, returns transparent-bg cutout
//   'swap_bg'    → source_url + backdrop_id (preset image), composites
//
// Server-side: PHOTOROOM_API_KEY stays out of clients.
// Daily quota: consume_render_quota() RPC, default 20/day/user.
// Cache: sha256(mode|inputs) → reuse prior output_url, no Photoroom call.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PHOTOROOM_API_KEY = Deno.env.get("PHOTOROOM_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DAILY_CAP = Number(Deno.env.get("VTO_DAILY_CAP") ?? "20");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function callPhotoroom(fields: Record<string, string>): Promise<{ status: number; bytes: Uint8Array; ct: string }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch("https://image-api.photoroom.com/v2/edit", {
    method: "POST",
    headers: { "x-api-key": PHOTOROOM_API_KEY },
    body: fd,
  });
  const buf = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, bytes: buf, ct: r.headers.get("content-type") ?? "image/png" };
}

async function uploadResult(supa: ReturnType<typeof createClient>, key: string, bytes: Uint8Array) {
  const path = `vto-renders/${key}.png`;
  const { error } = await supa.storage.from("cutouts").upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`upload: ${error.message}`);
  return `${SUPABASE_URL}/storage/v1/object/public/cutouts/${path}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return jsonRes({ error: "unauthorized" }, 401);

  // Resolve calling user via JWT
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonRes({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // Service-role client for RPC + storage + writes
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ error: "bad_json" }, 400); }

  const mode = body.mode;
  if (!mode || !['vto', 'remove_bg', 'swap_bg'].includes(mode)) {
    return jsonRes({ error: "invalid_mode" }, 400);
  }

  // Build photoroom request + cache key per mode
  let prFields: Record<string, string> = {};
  let cacheParts: string[] = [mode];

  if (mode === 'vto') {
    if (!body.garment_url || !body.selfie_url) return jsonRes({ error: "missing_inputs" }, 400);
    prFields = {
      "imageUrl": body.garment_url,
      "virtualModel.mode": "ai.auto",
      "virtualModel.model.custom.imageUrl": body.selfie_url,
      "virtualModel.pose": body.pose ?? "standing",
      "virtualModel.size": "PORTRAIT_HD_3_2",
      // Paper-doll output: no scene preset.
    };
    cacheParts.push(body.garment_url, body.selfie_url, body.pose ?? "standing");
  } else if (mode === 'remove_bg') {
    if (!body.source_url) return jsonRes({ error: "missing_inputs" }, 400);
    prFields = {
      "imageUrl": body.source_url,
      "background.color": "transparent",
      "padding": "0.05",
    };
    cacheParts.push(body.source_url);
  } else if (mode === 'swap_bg') {
    if (!body.source_url || !body.backdrop_id) return jsonRes({ error: "missing_inputs" }, 400);
    const { data: bd, error: bdErr } = await supa
      .from("creator_backdrops")
      .select("image_url, active")
      .eq("id", body.backdrop_id)
      .single();
    if (bdErr || !bd?.active) return jsonRes({ error: "invalid_backdrop" }, 400);
    prFields = {
      "imageUrl": body.source_url,
      "background.imageUrl": bd.image_url,
    };
    cacheParts.push(body.source_url, body.backdrop_id);
  }

  const cacheKey = await sha256(cacheParts.join("|"));

  // Cache hit? Reuse prior output, skip Photoroom + quota.
  const { data: cached } = await supa
    .from("vto_renders")
    .select("id, output_url")
    .eq("cache_key", cacheKey)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached?.output_url) {
    // Log a cached row so user sees it in their history
    await supa.from("vto_renders").insert({
      user_id: userId,
      mode,
      garment_url: body.garment_url ?? null,
      selfie_url: body.selfie_url ?? null,
      source_url: body.source_url ?? null,
      backdrop_id: body.backdrop_id ?? null,
      look_id: body.look_id ?? null,
      output_url: cached.output_url,
      status: "cached",
      cost_cents: 0,
      cache_key: cacheKey,
      completed_at: new Date().toISOString(),
    });
    return jsonRes({ output_url: cached.output_url, cached: true });
  }

  // Quota check (atomic)
  const { data: ok, error: quotaErr } = await supa.rpc("consume_render_quota", {
    p_user_id: userId,
    p_daily_cap: DAILY_CAP,
  });
  if (quotaErr) return jsonRes({ error: "quota_check_failed", detail: quotaErr.message }, 500);
  if (!ok) return jsonRes({ error: "daily_quota_exceeded", cap: DAILY_CAP }, 429);

  // Insert pending row
  const { data: pending, error: pendErr } = await supa
    .from("vto_renders")
    .insert({
      user_id: userId,
      mode,
      garment_url: body.garment_url ?? null,
      selfie_url: body.selfie_url ?? null,
      source_url: body.source_url ?? null,
      backdrop_id: body.backdrop_id ?? null,
      look_id: body.look_id ?? null,
      cache_key: cacheKey,
      status: "pending",
    })
    .select("id")
    .single();

  if (pendErr || !pending) return jsonRes({ error: "db_insert_failed", detail: pendErr?.message }, 500);

  // Call Photoroom
  const pr = await callPhotoroom(prFields);
  if (pr.status !== 200) {
    const errText = new TextDecoder().decode(pr.bytes).slice(0, 500);
    await supa.from("vto_renders").update({
      status: "failed",
      error: `photoroom_${pr.status}: ${errText}`,
      completed_at: new Date().toISOString(),
    }).eq("id", pending.id);
    return jsonRes({ error: "photoroom_failed", status: pr.status, detail: errText }, 502);
  }

  // Upload output
  let outputUrl: string;
  try {
    outputUrl = await uploadResult(supa, `${userId}/${cacheKey}`, pr.bytes);
  } catch (e) {
    await supa.from("vto_renders").update({
      status: "failed",
      error: `upload: ${(e as Error).message}`,
      completed_at: new Date().toISOString(),
    }).eq("id", pending.id);
    return jsonRes({ error: "upload_failed", detail: (e as Error).message }, 500);
  }

  await supa.from("vto_renders").update({
    status: "complete",
    output_url: outputUrl,
    completed_at: new Date().toISOString(),
  }).eq("id", pending.id);

  return jsonRes({ output_url: outputUrl, render_id: pending.id, cached: false });
});
