// remove-background — Supabase Edge Function port of the Hono backend's
// /api/remove-background route (Vibecode migration, 2026-07-09). Logic
// verbatim; framework surface converted (Hono → Deno.serve), Node Buffer →
// Uint8Array, env via Deno.env. Validation is a hand check with the same
// accepted shapes (the app always sends valid bodies; invalid ones get a
// clean 400 envelope).
//
// verify_jwt=false — matches the legacy backend's exposure. Every failure
// path falls back to returning the ORIGINAL image URL (source: "fallback"),
// exactly like legacy: the app never breaks because a cutout failed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PHOTOROOM_API_KEY = Deno.env.get("PHOTOROOM_API_KEY") ?? "";

const BUCKET = "cutouts";

type Mode = "bgRemove" | "ghostMannequin" | "flatLay";

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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extraHeaders },
  });
}

/** sha256 hex — replaces node:crypto createHash for the cache key. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Builds the multipart body sent to Photoroom /v2/edit. Same `imageUrl` field
 * for every mode; the mode adds an extra parameter that flips the model.
 */
function buildPhotoroomForm(imageUrl: string, mode: Mode, prompt?: string): FormData {
  const form = new FormData();
  form.append("imageUrl", imageUrl);
  if (mode === "ghostMannequin") {
    form.append("ghostMannequin.mode", "ai.auto");
    if (prompt) form.append("ghostMannequin.prompt", prompt);
  }
  if (mode === "flatLay") {
    form.append("flatLay.mode", "ai.auto");
  }
  return form;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ error: { message: "Not found", code: "NOT_FOUND" } }, 404);
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: "Invalid JSON body", code: "VALIDATION_ERROR" } }, 400);
  }
  const image_url: unknown = body?.image_url;
  const modeRaw: unknown = body?.mode;
  const prompt: string | undefined =
    typeof body?.prompt === "string" ? body.prompt : undefined;

  let urlOk = false;
  try { if (typeof image_url === "string") { new URL(image_url); urlOk = true; } } catch { /* */ }
  if (!urlOk) {
    return json({ error: { message: "image_url must be a valid URL", code: "VALIDATION_ERROR" } }, 400);
  }
  const mode: Mode =
    modeRaw === "ghostMannequin" || modeRaw === "flatLay" || modeRaw === "bgRemove"
      ? (modeRaw as Mode)
      : "bgRemove";
  const imageUrl = image_url as string;

  if (!PHOTOROOM_API_KEY) {
    console.error("[removeBackground] PHOTOROOM_API_KEY unset — falling back to original image");
    return json({ data: { cutout_photo_url: imageUrl, source: "fallback", mode } }, 200, {
      "X-Cutout-Source": "fallback-no-key",
    });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("[removeBackground] Supabase storage not configured — falling back to original image");
    return json({ data: { cutout_photo_url: imageUrl, source: "fallback", mode } }, 200, {
      "X-Cutout-Source": "fallback-no-storage",
    });
  }

  // Storage path is namespaced by mode so the same source URL processed in two
  // modes produces two distinct cached files.
  const hashInput = prompt ? `${imageUrl}::${prompt}` : imageUrl;
  const hash = await sha256Hex(hashInput);
  const path = `${mode}/${hash}.png`;

  try {
    const { data: existing } = await supabase.storage.from(BUCKET).list(mode, {
      limit: 1,
      search: `${hash}.png`,
    });
    if (existing && existing.some((f: { name: string }) => f.name === `${hash}.png`)) {
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      console.log(`[removeBackground] cache hit (${path}), skipping Photoroom`);
      return json({ data: { cutout_photo_url: pub.publicUrl, source: "cache", mode } }, 200, {
        "X-Cutout-Source": "cache",
      });
    }
  } catch (err) {
    console.warn("[removeBackground] storage list failed (non-fatal):", err);
  }

  try {
    const response = await fetch("https://image-api.photoroom.com/v2/edit", {
      method: "POST",
      headers: { "x-api-key": PHOTOROOM_API_KEY },
      body: buildPhotoroomForm(imageUrl, mode, prompt),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `[removeBackground] Photoroom (${mode}) failed, falling back to original:`,
        response.status,
        text.slice(0, 300),
      );
      return json({ data: { cutout_photo_url: imageUrl, source: "fallback", mode } }, 200, {
        "X-Cutout-Source": `fallback-${response.status}`,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const pngBytes = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, pngBytes, { contentType: "image/png", upsert: true });

    if (uploadError) {
      console.error("[removeBackground] Supabase upload failed, falling back to original:", uploadError);
      return json({ data: { cutout_photo_url: imageUrl, source: "fallback", mode } }, 200, {
        "X-Cutout-Source": "fallback-upload",
      });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[removeBackground] uploaded fresh ${mode} cutout to ${path}`);
    return json({ data: { cutout_photo_url: pub.publicUrl, source: "photoroom", mode } }, 200, {
      "X-Cutout-Source": "photoroom",
    });
  } catch (err) {
    console.error("[removeBackground] unexpected error, falling back to original:", err);
    return json({ data: { cutout_photo_url: imageUrl, source: "fallback", mode } }, 200, {
      "X-Cutout-Source": "fallback-error",
    });
  }
});
