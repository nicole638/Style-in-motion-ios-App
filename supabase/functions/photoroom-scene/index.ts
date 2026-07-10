// photoroom-scene EF — generates an editorial AI background around a cutout.
//
// Wraps Photoroom v2/edit with ai.background.prompt to place a subject
// (cutout PNG) into a generated lifestyle / editorial scene. Saves the
// result to supabase storage and returns the public URL.
//
// Body: { image_url: string, prompt: string, creator_id?: string, label?: string }
// Returns: { ok, url, source_url, prompt }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PHOTOROOM_API_KEY = Deno.env.get("PHOTOROOM_API_KEY")!;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  let body: { image_url?: string; prompt?: string; creator_id?: string; label?: string };
  try { body = await req.json(); } catch { return jsonRes({ error: "bad_json" }, 400); }
  const imageUrl = body.image_url?.trim();
  const prompt = body.prompt?.trim();
  if (!imageUrl || !prompt) return jsonRes({ error: "missing_params" }, 400);

  // 1) Fetch source image
  const srcRes = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  if (!srcRes.ok) return jsonRes({ error: "source_fetch_failed", status: srcRes.status }, 502);
  const srcBytes = new Uint8Array(await srcRes.arrayBuffer());
  const srcCt = (srcRes.headers.get("content-type") ?? "image/png").split(";")[0];

  // 2) Call Photoroom with ai.background.prompt — generates a fitting backdrop
  const fd = new FormData();
  const ext = srcCt.includes("png") ? "png" : srcCt.includes("webp") ? "webp" : "jpg";
  fd.append("imageFile", new Blob([srcBytes], { type: srcCt }), `source.${ext}`);
  fd.append("background.color", "transparent");
  fd.append("ai.background.prompt", prompt);
  fd.append("ai.background.guidance", "editorial");

  const pr = await fetch("https://image-api.photoroom.com/v2/edit", {
    method: "POST",
    headers: { "x-api-key": PHOTOROOM_API_KEY },
    body: fd,
    signal: AbortSignal.timeout(60000),
  });
  if (!pr.ok) {
    const errText = new TextDecoder().decode(new Uint8Array(await pr.arrayBuffer())).slice(0, 500);
    return jsonRes({ error: `photoroom_${pr.status}`, detail: errText }, 502);
  }
  const outBytes = new Uint8Array(await pr.arrayBuffer());

  // 3) Upload to storage
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const creatorId = body.creator_id ?? "public";
  const label = (body.label ?? "scene").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const path = `scenes/${creatorId}/${label}-${Date.now()}.png`;
  const { error: upErr } = await supa.storage.from("item-photos")
    .upload(path, outBytes, { contentType: "image/png", upsert: true, cacheControl: "3600" });
  if (upErr) return jsonRes({ error: "upload_failed", detail: upErr.message }, 500);

  const url = `${SUPABASE_URL}/storage/v1/object/public/item-photos/${path}`;
  return jsonRes({ ok: true, url, source_url: imageUrl, prompt });
});
