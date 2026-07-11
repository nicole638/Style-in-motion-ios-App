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

  // 4) The copyable commissionable link (shop-redirect stamps tag + logs click).
  const shareUrl = `${SHARE_BASE}/api/shop?creatorItemId=${encodeURIComponent(itemId)}&source=share`;

  return jsonRes({ data: { itemId, shareUrl, lookId } });
});
