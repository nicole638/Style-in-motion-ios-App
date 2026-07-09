/**
 * ONE-SHOT BACKFILL: Generate ghost-mannequin cutouts for closet items
 * that don't yet have one cached.
 *
 * Usage:
 *   bun run backend/scripts/backfill-cutouts.ts
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and PHOTOROOM_API_KEY from
 * the backend's .env (loaded automatically by Bun).
 *
 * Calls Photoroom + uploads to Supabase Storage directly — does NOT go
 * through /api/remove-background (that route can return base64 in dev).
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PHOTOROOM_API_KEY = process.env.PHOTOROOM_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[backfill] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!PHOTOROOM_API_KEY) {
  console.error("[backfill] Missing PHOTOROOM_API_KEY");
  process.exit(1);
}

const BUCKET = "cutouts";
const MODE = "ghostMannequin" as const;
const BATCH_SIZE = 5;
// Photoroom v2/edit ghost-mannequin (Plus plan): $0.10 per successful call.
const COST_PER_CALL = 0.10;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type Item = { id: string; name: string | null; photo_url: string };

async function processItem(item: Item): Promise<"ok" | "fail"> {
  const label = item.name ?? "(unnamed)";
  try {
    const hash = createHash("sha256").update(item.photo_url).digest("hex");
    const path = `${MODE}/${hash}.png`;

    let publicUrl: string | null = null;

    // Reuse existing cached cutout if present (dedupe across items with the same photo_url).
    try {
      const { data: existing } = await supabase.storage.from(BUCKET).list(MODE, {
        limit: 1,
        search: `${hash}.png`,
      });
      if (existing && existing.some((f) => f.name === `${hash}.png`)) {
        publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
    } catch {
      // non-fatal; fall through to Photoroom call
    }

    if (!publicUrl) {
      const form = new FormData();
      form.append("imageUrl", item.photo_url);
      form.append("ghostMannequin.mode", "ai.auto");

      const response = await fetch("https://image-api.photoroom.com/v2/edit", {
        method: "POST",
        headers: { "x-api-key": PHOTOROOM_API_KEY! },
        body: form,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.log(`[backfill] FAIL ${item.id} ${label} photoroom_${response.status}: ${text.slice(0, 200)}`);
        return "fail";
      }

      const arrayBuffer = await response.arrayBuffer();
      const pngBuffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, pngBuffer, { contentType: "image/png", upsert: true });
      if (uploadError) {
        console.log(`[backfill] FAIL ${item.id} ${label} upload: ${uploadError.message}`);
        return "fail";
      }

      publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }

    const { error: updateError } = await supabase
      .from("creator_items")
      .update({ cutout_photo_url: publicUrl })
      .eq("id", item.id);
    if (updateError) {
      console.log(`[backfill] FAIL ${item.id} ${label} db_update: ${updateError.message}`);
      return "fail";
    }

    console.log(`[backfill] OK ${item.id} ${label}`);
    return "ok";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`[backfill] FAIL ${item.id} ${label} exception: ${reason}`);
    return "fail";
  }
}

async function main() {
  const { data: items, error } = await supabase
    .from("creator_items")
    .select("id, name, photo_url")
    .eq("archived", false)
    .is("cutout_photo_url", null)
    .not("photo_url", "is", null)
    .neq("photo_url", "");

  if (error) {
    console.error("[backfill] query failed:", error.message);
    process.exit(1);
  }

  const rows = (items ?? []) as Item[];
  console.log(`[backfill] found ${rows.length} items to process`);

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(processItem));
    for (const r of results) {
      if (r === "ok") successful++;
      else failed++;
    }
  }

  const totalCost = (successful * COST_PER_CALL).toFixed(2);
  console.log(
    `[backfill] processed=${rows.length} successful=${successful} failed=${failed} skipped=${skipped} total_cost=$${totalCost}`,
  );
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
