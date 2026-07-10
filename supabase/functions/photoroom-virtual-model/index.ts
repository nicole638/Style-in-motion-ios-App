// photoroom-virtual-model — v5 (2026-06-30)
//
// v5: NO-BACKGROUND option. Virtual Model always bakes a scene into the
// generation — there's no native transparent output. When no_background=true we
// generate the model on a neutral STUDIO scene (cleanest edges/lighting), then
// run a second PhotoRoom pass (background.color=transparent) on the result → the
// model + garments cut out on transparent, ready to drop into a collage. The
// no_background flag is part of the cache key so it doesn't collide with scened
// results. Costs 2 PhotoRoom calls when on (gen + remove-bg).
//
// v4: enforce Photoroom's cap of 3 additionalProductImages (4 items total).
// v3: aspect_ratio in response. v2: multi-garment. v1: single garment, cache.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PHOTOROOM_API_KEY = Deno.env.get("PHOTOROOM_API_KEY")!;

const MAX_ADDITIONAL_PRODUCTS = 3;

const MODEL_PRESETS = new Set([
  "avery", "sam", "taylor", "kendall", "jordan", "casey", "maya", "reece",
  "lena", "julia", "jackson", "sophia", "emma", "ava", "zoe", "fiona",
]);
const SCENE_PRESETS = new Set([
  "random", "street", "bedroom", "sunset", "factory", "studio",
  "coloredstudio", "concretestudio", "beach", "tropical", "library",
  "forest", "businessdistrict", "countryside", "flowers", "goldenlight",
  "mountain", "pool", "latincity", "cafe", "asiancity", "nightlights", "desert",
]);
const POSES = new Set([
  "random", "standing", "34turn", "powerstance", "walkingforward",
  "handinpocket", "crossedarms", "back", "overtheshoulder", "seated",
  "adjustingclothing", "playfulspin",
]);
const SIZES = new Set([
  "PORTRAIT_HD_16_9", "PORTRAIT_HD_4_3", "PORTRAIT_HD_3_2",
  "SQUARE_HD", "LANDSCAPE_HD_3_2", "LANDSCAPE_HD_4_3", "LANDSCAPE_HD_16_9",
]);

const SIZE_ASPECT_RATIO: Record<string, number> = {
  "PORTRAIT_HD_16_9":  9 / 16,
  "PORTRAIT_HD_4_3":   3 / 4,
  "PORTRAIT_HD_3_2":   2 / 3,
  "SQUARE_HD":         1,
  "LANDSCAPE_HD_3_2":  3 / 2,
  "LANDSCAPE_HD_4_3":  4 / 3,
  "LANDSCAPE_HD_16_9": 16 / 9,
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// v5: strip the scene from a generated virtual-model image → model on transparent.
async function removeBackground(bytes: Uint8Array): Promise<{ status: number; bytes: Uint8Array }> {
  const fd = new FormData();
  fd.append("imageFile", new Blob([bytes], { type: "image/png" }), "model.png");
  fd.append("background.color", "transparent");
  fd.append("padding", "0.03");
  const r = await fetch("https://image-api.photoroom.com/v2/edit", {
    method: "POST", headers: { "x-api-key": PHOTOROOM_API_KEY }, body: fd,
    signal: AbortSignal.timeout(60000),
  });
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  let body: {
    creator_id?: string;
    item_id?: string;
    image_url?: string;
    additional_product_urls?: string[];
    model_preset?: string;
    model_custom_url?: string;
    scene_preset?: string;
    scene_custom_url?: string;
    pose?: string;
    prompt?: string;
    size?: string;
    no_background?: boolean;
    force?: boolean;
  };
  try { body = await req.json(); } catch { return jsonRes({ error: "bad_json" }, 400); }

  const imageUrl = body.image_url?.trim();
  if (!imageUrl) return jsonRes({ error: "missing_image_url" }, 400);

  const noBg = body.no_background === true;
  const modelPreset = body.model_preset?.trim().toLowerCase();
  // When no_background, the scene is irrelevant (it gets removed) — force a
  // neutral studio for the cleanest model edges + lighting, ignore any scene input.
  const sceneType = noBg ? "studio" : body.scene_preset?.trim().toLowerCase();
  const pose = body.pose?.trim().toLowerCase() ?? "random";
  const size = body.size?.trim() ?? "PORTRAIT_HD_3_2";

  if (modelPreset && !MODEL_PRESETS.has(modelPreset)) return jsonRes({ error: "invalid_model_preset", got: modelPreset }, 400);
  if (sceneType && !SCENE_PRESETS.has(sceneType)) return jsonRes({ error: "invalid_scene_preset", got: sceneType }, 400);
  if (!POSES.has(pose)) return jsonRes({ error: "invalid_pose", got: pose }, 400);
  if (!SIZES.has(size)) return jsonRes({ error: "invalid_size", got: size }, 400);

  const aspectRatio = SIZE_ASPECT_RATIO[size];

  const rawAdditional = (body.additional_product_urls ?? []).filter((u) => typeof u === "string" && u.trim().length > 0);
  const additionalUrls = rawAdditional.slice(0, MAX_ADDITIONAL_PRODUCTS);
  const truncated = rawAdditional.length > MAX_ADDITIONAL_PRODUCTS;
  const droppedCount = rawAdditional.length - additionalUrls.length;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  const cacheKeyStr = [
    imageUrl,
    additionalUrls.join("|"),
    modelPreset ?? body.model_custom_url ?? "",
    noBg ? "nobg" : (sceneType ?? body.scene_custom_url ?? ""),
    pose,
    body.prompt ?? "",
    size,
  ].join("::");
  const sourceHash = await sha256Hex(cacheKeyStr);

  if (!body.force && body.creator_id) {
    const { data: cached } = await supa.from("creator_virtual_models")
      .select("result_url, model_preset, scene_preset, pose, size_preset")
      .eq("creator_id", body.creator_id)
      .eq("source_hash", sourceHash)
      .maybeSingle();
    if (cached?.result_url) {
      const cachedSize = (cached.size_preset as string | null) ?? size;
      return jsonRes({
        ok: true, url: cached.result_url, cached: true, source_hash: sourceHash,
        model_preset: cached.model_preset, scene_preset: cached.scene_preset, pose: cached.pose,
        size: cachedSize, aspect_ratio: SIZE_ASPECT_RATIO[cachedSize] ?? aspectRatio,
        no_background: noBg,
        truncated_additional: truncated, dropped_additional_count: droppedCount,
      });
    }
  }

  let srcBytes: Uint8Array;
  let srcContentType: string;
  try {
    const srcRes = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
    if (!srcRes.ok) return jsonRes({ error: "source_fetch_failed", status: srcRes.status }, 502);
    srcBytes = new Uint8Array(await srcRes.arrayBuffer());
    srcContentType = (srcRes.headers.get("content-type") ?? "image/png").split(";")[0].trim();
  } catch (e) {
    return jsonRes({ error: "source_fetch_threw", detail: (e as Error).message }, 502);
  }

  const fd = new FormData();
  const ext = srcContentType.includes("png") ? "png" : srcContentType.includes("webp") ? "webp" : "jpg";
  fd.append("imageFile", new Blob([srcBytes], { type: srcContentType }), `source.${ext}`);
  fd.append("removeBackground", "false");
  fd.append("referenceBox", "originalImage");
  fd.append("virtualModel.mode", "ai.auto");
  fd.append("virtualModel.size", size);
  fd.append("virtualModel.pose", pose);
  if (modelPreset) fd.append("virtualModel.model.preset.name", modelPreset);
  else if (body.model_custom_url) fd.append("virtualModel.model.custom.imageUrl", body.model_custom_url);
  if (sceneType) fd.append("virtualModel.scene.preset.name", sceneType);
  else if (!noBg && body.scene_custom_url) fd.append("virtualModel.scene.custom.imageUrl", body.scene_custom_url);
  if (body.prompt) fd.append("virtualModel.prompt", body.prompt);
  for (let i = 0; i < additionalUrls.length; i++) {
    fd.append(`virtualModel.additionalProductImages[${i}].imageUrl`, additionalUrls[i]);
  }

  let prRes: Response;
  try {
    prRes = await fetch("https://image-api.photoroom.com/v2/edit", {
      method: "POST",
      headers: { "x-api-key": PHOTOROOM_API_KEY },
      body: fd,
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    return jsonRes({ error: "photoroom_threw", detail: (e as Error).message }, 502);
  }

  if (!prRes.ok) {
    const errText = new TextDecoder().decode(new Uint8Array(await prRes.arrayBuffer())).slice(0, 500);
    return jsonRes({
      error: `photoroom_${prRes.status}`,
      detail: errText,
      hint: prRes.status === 500 && additionalUrls.length >= 3
        ? "Try fewer items — Photoroom Virtual Model caps at 4 total items (1 primary + 3 additional)."
        : undefined,
      items_attempted: 1 + additionalUrls.length,
    }, 502);
  }

  let outBytes = new Uint8Array(await prRes.arrayBuffer());
  let noBgApplied = false;

  // v5: second pass — strip the studio scene so it's just the model cutout.
  if (noBg) {
    try {
      const cut = await removeBackground(outBytes);
      if (cut.status === 200 && cut.bytes.byteLength > 2048) {
        outBytes = cut.bytes;
        noBgApplied = true;
      } else {
        console.warn("no_background_removebg_failed", cut.status);
      }
    } catch (e) {
      console.warn("no_background_removebg_threw", (e as Error).message);
    }
  }

  const creatorBucket = body.creator_id ?? "public";
  const path = `virtual-models/${creatorBucket}/${sourceHash.slice(0, 16)}.png`;
  const { error: upErr } = await supa.storage.from("item-photos")
    .upload(path, outBytes, { contentType: "image/png", upsert: true, cacheControl: "86400" });
  if (upErr) return jsonRes({ error: "upload_failed", detail: upErr.message }, 500);

  const resultUrl = `${SUPABASE_URL}/storage/v1/object/public/item-photos/${path}`;

  if (body.creator_id) {
    await supa.from("creator_virtual_models").upsert({
      creator_id: body.creator_id,
      item_id: body.item_id ?? null,
      source_url: imageUrl,
      source_hash: sourceHash,
      model_preset: modelPreset ?? null,
      model_custom_url: body.model_custom_url ?? null,
      scene_preset: noBg ? "none" : (sceneType ?? null),
      scene_custom_url: noBg ? null : (body.scene_custom_url ?? null),
      pose,
      prompt: body.prompt ?? null,
      size_preset: size,
      result_url: resultUrl,
    }, { onConflict: "creator_id,source_hash" });
  }

  return jsonRes({
    ok: true, url: resultUrl, cached: false, source_hash: sourceHash,
    model_preset: modelPreset ?? "avery", scene_preset: noBg ? "none" : (sceneType ?? "random"),
    pose, size, aspect_ratio: aspectRatio,
    no_background: noBg, no_background_applied: noBgApplied,
    additional_products_passed: additionalUrls.length,
    items_used: 1 + additionalUrls.length,
    max_items_supported: 1 + MAX_ADDITIONAL_PRODUCTS,
    truncated_additional: truncated,
    dropped_additional_count: droppedCount,
  });
});
