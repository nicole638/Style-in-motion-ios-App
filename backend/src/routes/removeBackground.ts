import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash } from "node:crypto";
import { env } from "../env";
import { getSupabaseAdmin } from "../lib/supabase";

const removeBackgroundRouter = new Hono();
const BUCKET = "cutouts";

type Mode = "bgRemove" | "ghostMannequin" | "flatLay";

const bodySchema = z.object({
  image_url: z.string().url(),
  mode: z.enum(["bgRemove", "ghostMannequin", "flatLay"]).optional().default("bgRemove"),
  prompt: z.string().optional(),
});

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

removeBackgroundRouter.post("/", zValidator("json", bodySchema), async (c) => {
  const { image_url, mode, prompt } = c.req.valid("json");

  if (!env.PHOTOROOM_API_KEY) {
    console.error("[removeBackground] PHOTOROOM_API_KEY unset — falling back to original image");
    c.header("X-Cutout-Source", "fallback-no-key");
    return c.json({ data: { cutout_photo_url: image_url, source: "fallback", mode } });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("[removeBackground] Supabase storage not configured — falling back to original image");
    c.header("X-Cutout-Source", "fallback-no-storage");
    return c.json({ data: { cutout_photo_url: image_url, source: "fallback", mode } });
  }

  // Storage path is namespaced by mode so the same source URL processed in two
  // modes produces two distinct cached files. Old top-level cutouts/<hash>.png
  // objects are orphaned — column gets overwritten as collages re-render.
  const hashInput = prompt ? `${image_url}::${prompt}` : image_url;
  const hash = createHash("sha256").update(hashInput).digest("hex");
  const path = `${mode}/${hash}.png`;

  try {
    const { data: existing } = await supabase.storage.from(BUCKET).list(mode, {
      limit: 1,
      search: `${hash}.png`,
    });
    if (existing && existing.some((f) => f.name === `${hash}.png`)) {
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      console.log(`[removeBackground] cache hit (${path}), skipping Photoroom`);
      c.header("X-Cutout-Source", "cache");
      return c.json({ data: { cutout_photo_url: pub.publicUrl, source: "cache", mode } });
    }
  } catch (err) {
    console.warn("[removeBackground] storage list failed (non-fatal):", err);
  }

  try {
    const response = await fetch("https://image-api.photoroom.com/v2/edit", {
      method: "POST",
      headers: { "x-api-key": env.PHOTOROOM_API_KEY },
      body: buildPhotoroomForm(image_url, mode, prompt),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[removeBackground] Photoroom (${mode}) failed, falling back to original:`, response.status, text.slice(0, 300));
      c.header("X-Cutout-Source", `fallback-${response.status}`);
      return c.json({ data: { cutout_photo_url: image_url, source: "fallback", mode } });
    }

    const arrayBuffer = await response.arrayBuffer();
    const pngBuffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, pngBuffer, { contentType: "image/png", upsert: true });

    if (uploadError) {
      console.error("[removeBackground] Supabase upload failed, falling back to original:", uploadError);
      c.header("X-Cutout-Source", "fallback-upload");
      return c.json({ data: { cutout_photo_url: image_url, source: "fallback", mode } });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[removeBackground] uploaded fresh ${mode} cutout to ${path}`);
    c.header("X-Cutout-Source", "photoroom");
    return c.json({ data: { cutout_photo_url: pub.publicUrl, source: "photoroom", mode } });
  } catch (err) {
    console.error("[removeBackground] unexpected error, falling back to original:", err);
    c.header("X-Cutout-Source", "fallback-error");
    return c.json({ data: { cutout_photo_url: image_url, source: "fallback", mode } });
  }
});

export { removeBackgroundRouter };
