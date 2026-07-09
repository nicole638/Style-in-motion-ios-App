/**
 * Rerun the merchant-image cache for a single item, using the updated
 * cacheMerchantImage helper (which now falls back to HTTP/1.1 for CDNs that
 * reject HTTP/2 fingerprints — e.g. Gucci's WAF).
 *
 * Usage:
 *   bun run backend/scripts/retry-cache-item.ts <item_id>
 */

import { createClient } from "@supabase/supabase-js";
import { cacheMerchantImage } from "../src/lib/cacheMerchantImage";

const itemId = process.argv[2];
if (!itemId) {
  console.error("usage: bun run backend/scripts/retry-cache-item.ts <item_id>");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[retry-cache-item] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: row, error: readErr } = await supabase
  .from("creator_items")
  .select("id, photo_url, original_photo_url")
  .eq("id", itemId)
  .single();

if (readErr || !row) {
  console.error("[retry-cache-item] read failed:", readErr?.message);
  process.exit(1);
}

const sourceUrl = row.original_photo_url ?? row.photo_url;
console.log(`[retry-cache-item] item=${row.id} source=${sourceUrl}`);

const result = await cacheMerchantImage(sourceUrl);
console.log(`[retry-cache-item] result photo_url=${result.photo_url}`);
console.log(`[retry-cache-item] result original_photo_url=${result.original_photo_url}`);

if (!result.original_photo_url) {
  console.error("[retry-cache-item] cache failed (passthrough). aborting db update.");
  process.exit(1);
}

const { error: updateErr } = await supabase
  .from("creator_items")
  .update({ photo_url: result.photo_url, original_photo_url: result.original_photo_url })
  .eq("id", row.id);

if (updateErr) {
  console.error("[retry-cache-item] update failed:", updateErr.message);
  process.exit(1);
}

console.log(`[retry-cache-item] OK item=${row.id}`);
