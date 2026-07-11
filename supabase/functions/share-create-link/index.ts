// share-create-link — commit step for the rich iOS share extension. Takes the
// creator's edited choices from the share sheet and creates the closet item +
// returns a copyable commissionable link (the Snapshop "Create Quick Link").
//
//   POST {
//     token, url,
//     name?, brand?, price?, image_url?, note?, category?,
//     look_id?,            // attach to an existing Look (collection)
//     new_look_title?      // OR create a new Look and attach
//   }
//   → { data: { itemId, shareUrl, lookId } }
//   → { error: { message, code } }
//
// The item is inserted fetch_status='complete' with the creator's chosen image,
// so the normal async re-scrape does NOT run and overwrite their pick. The
// returned shareUrl routes through shop-redirect (creatorItemId mode), which
// stamps the creator's affiliate tag + logs the click at open time — so the
// link is commissionable even for items we didn't pre-wrap.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// The public gateway the creator's shared link points at (Nicole-owned).
const SHARE_BASE = (Deno.env.get("SIM_SHARE_LINK_BASE") ?? "https://api.styledinmotion.app").replace(/\/+$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function errRes(message: string, code: string, status: number) {
  return jsonRes({ error: { message, code } }, status);
}

function nullableTrim(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cache a merchant image into Supabase Storage (item-photos/cache) so the saved
// item's photo never decays — same bucket/scheme as the app's cacheMerchantImage.
// Runs in the background (EdgeRuntime.waitUntil) so it never slows the response.
// Best-effort: on any failure the merchant URL just stays as-is.
async function cacheAndUpdatePhoto(
  supa: ReturnType<typeof createClient>,
  itemId: string,
  merchantUrl: string,
): Promise<void> {
  const BUCKET = "item-photos";
  const PREFIX = "cache";
  const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
  try {
    const hash = await sha256Hex(merchantUrl);
    // Reuse an already-cached object for this URL if present.
    let publicUrl: string | null = null;
    const { data: existing } = await supa.storage.from(BUCKET).list(PREFIX, { limit: 5, search: hash });
    const hit = (existing ?? []).find((f: { name: string }) => f.name.startsWith(`${hash}.`));
    if (hit) {
      publicUrl = supa.storage.from(BUCKET).getPublicUrl(`${PREFIX}/${hit.name}`).data.publicUrl;
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(merchantUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      }).finally(() => clearTimeout(timer));
      if (!res.ok) return;
      const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = EXT[ct] ?? "jpg";
      const bytes = new Uint8Array(await res.arrayBuffer());
      const path = `${PREFIX}/${hash}.${ext}`;
      const { error: upErr } = await supa.storage.from(BUCKET).upload(path, bytes, {
        contentType: ct || `image/${ext === "jpg" ? "jpeg" : ext}`,
        upsert: true,
      });
      if (upErr) return;
      publicUrl = supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }
    if (publicUrl && publicUrl !== merchantUrl) {
      await supa.from("creator_items")
        .update({ photo_url: publicUrl, original_photo_url: merchantUrl })
        .eq("id", itemId);
    }
  } catch (_e) {
    // best-effort; merchant URL stays
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errRes("Method not allowed", "METHOD_NOT_ALLOWED", 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }

  const url = nullableTrim(body.url) ?? "";
  const token = nullableTrim(body.token) ?? "";
  if (!token) return errRes("Missing token", "MISSING_TOKEN", 400);
  if (!/^https?:\/\//i.test(url)) return errRes("Invalid URL", "INVALID_URL", 400);

  const name = nullableTrim(body.name) ?? "";               // creator_items.name is NOT NULL
  const brand = nullableTrim(body.brand);
  const price = nullableTrim(body.price);
  const imageUrl = nullableTrim(body.image_url);
  const note = nullableTrim(body.note);
  const category = nullableTrim(body.category) ?? "Other";
  const lookIdIn = nullableTrim(body.look_id);
  const newLookTitle = nullableTrim(body.new_look_title);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Resolve creator from the device token.
  const { data: tok, error: tokErr } = await supa
    .from("share_device_tokens")
    .select("creator_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (tokErr) return errRes("Token lookup failed", "TOKEN_LOOKUP_FAILED", 500);
  if (!tok || (tok as Record<string, unknown>).revoked_at) {
    return errRes("Open the app and sign in", "INVALID_TOKEN", 401);
  }
  const creatorId = (tok as Record<string, unknown>).creator_id as string;

  // 1) Create the closet item with the creator's chosen image/details, marked
  //    complete so the async re-scrape doesn't clobber their pick.
  const nowIso = new Date().toISOString();
  const { data: item, error: insErr } = await supa
    .from("creator_items")
    .insert({
      creator_id: creatorId,
      url,
      name,
      brand,
      price,
      photo_url: imageUrl,
      original_photo_url: imageUrl,
      primary_note: note,
      category,
      fetch_status: "complete",
      fetch_completed_at: nowIso,
    })
    .select("id")
    .single();
  if (insErr || !item) {
    return errRes("Couldn't save the item", "INSERT_FAILED", 500);
  }
  const itemId = (item as Record<string, unknown>).id as string;

  // 2) Optionally attach to a collection (Look) — existing or newly created.
  let lookId: string | null = lookIdIn;
  try {
    if (!lookId && newLookTitle) {
      const { data: look } = await supa
        .from("looks")
        .insert({ creator_id: creatorId, title: newLookTitle, cover_photo_url: imageUrl })
        .select("id")
        .single();
      lookId = (look as Record<string, unknown> | null)?.id as string ?? null;
    }
    if (lookId) {
      // Append to the end of the look.
      const { data: last } = await supa
        .from("look_items")
        .select("sort_order")
        .eq("look_id", lookId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSort = ((last as Record<string, unknown> | null)?.sort_order as number ?? -1) + 1;
      await supa.from("look_items").insert({
        look_id: lookId,
        creator_item_id: itemId,
        sort_order: nextSort,
      });
    }
  } catch (_e) {
    // Collection attach is best-effort — the item + link still succeed.
  }

  // 3) Update last_used on the token (matches share-add-item).
  await supa.from("share_device_tokens").update({ last_used_at: nowIso }).eq("token", token);

  // 4) Durably cache the chosen image in the background so the response stays
  //    fast but the saved item's photo never decays.
  if (imageUrl) {
    const p = cacheAndUpdatePhoto(supa, itemId, imageUrl);
    const er = (globalThis as { EdgeRuntime?: { waitUntil?: (pr: Promise<unknown>) => void } }).EdgeRuntime;
    if (er?.waitUntil) er.waitUntil(p);
    else void p.catch(() => {});
  }

  // 5) The copyable commissionable link (shop-redirect stamps tag + logs click).
  const shareUrl = `${SHARE_BASE}/api/shop?creatorItemId=${encodeURIComponent(itemId)}&source=share`;

  return jsonRes({ data: { itemId, shareUrl, lookId } });
});
