/**
 * ONE-SHOT BACKFILL: Cache merchant product images to Supabase Storage for
 * existing closet items. After this runs, every active item with an external
 * photo_url will have it replaced by a stable supabase.co URL, with the
 * original merchant URL preserved on original_photo_url.
 *
 * Usage:
 *   bun run backend/scripts/backfill-product-images.ts
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the backend's .env
 * (loaded automatically by Bun).
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[backfill] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const BUCKET = "item-photos";
const CACHE_PREFIX = "cache";
const BATCH_SIZE = 5;
const FETCH_TIMEOUT_MS = 8000;

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extFromContentType(ct: string | null): string {
  if (!ct) return "jpg";
  const base = ct.split(";")[0]!.trim().toLowerCase();
  return CONTENT_TYPE_TO_EXT[base] ?? "jpg";
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type Item = { id: string; photo_url: string };
type Outcome = "ok" | "fail" | "skipped";

async function processItem(item: Item): Promise<Outcome> {
  const merchantUrl = item.photo_url;
  try {
    const hash = createHash("sha256").update(merchantUrl).digest("hex");

    let publicUrl: string | null = null;

    // Try matching any extension we already cached for this hash.
    try {
      const { data: existing } = await supabase.storage.from(BUCKET).list(CACHE_PREFIX, {
        limit: 5,
        search: hash,
      });
      const hit = (existing ?? []).find((f) => f.name.startsWith(`${hash}.`));
      if (hit) {
        publicUrl = supabase.storage.from(BUCKET).getPublicUrl(`${CACHE_PREFIX}/${hit.name}`).data.publicUrl;
      }
    } catch {
      // non-fatal; fall through to fetch+upload
    }

    if (!publicUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(merchantUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; styledinmotion-cache/1.0)",
            Accept: "image/*,*/*;q=0.8",
          },
          signal: controller.signal,
          redirect: "follow",
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        console.log(`[backfill] FAIL ${item.id} fetch_${res.status}`);
        return "fail";
      }

      const contentType = res.headers.get("content-type");
      const ext = extFromContentType(contentType);
      const path = `${CACHE_PREFIX}/${hash}.${ext}`;

      const arrayBuffer = await res.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: contentType ?? `image/${ext === "jpg" ? "jpeg" : ext}`,
        upsert: true,
      });
      if (uploadError) {
        console.log(`[backfill] FAIL ${item.id} upload: ${uploadError.message}`);
        return "fail";
      }

      publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }

    const { error: updateError } = await supabase
      .from("creator_items")
      .update({ photo_url: publicUrl, original_photo_url: merchantUrl })
      .eq("id", item.id);
    if (updateError) {
      console.log(`[backfill] FAIL ${item.id} db_update: ${updateError.message}`);
      return "fail";
    }

    console.log(`[backfill] OK ${item.id}`);
    return "ok";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`[backfill] FAIL ${item.id} exception: ${reason}`);
    return "fail";
  }
}

async function main() {
  const { data: items, error } = await supabase
    .from("creator_items")
    .select("id, photo_url")
    .eq("archived", false)
    .like("photo_url", "http%")
    .not("photo_url", "like", "%supabase.co%")
    .is("original_photo_url", null);

  if (error) {
    console.error("[backfill] query failed:", error.message);
    process.exit(1);
  }

  const rows = (items ?? []) as Item[];
  console.log(`[backfill] found ${rows.length} items to process`);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(processItem));
    for (const r of results) {
      if (r === "ok") succeeded++;
      else if (r === "skipped") skipped++;
      else failed++;
    }
  }

  console.log(
    `[backfill] processed=${rows.length} succeeded=${succeeded} failed=${failed} skipped=${skipped}`,
  );
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
