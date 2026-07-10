// pinterest-create-pin v3 — creates a Pinterest Pin from a SiM look.
//
// PRODUCTION (2026-06-24): the app is approved for production. Verified the
// creator's OAuth token returns 200 from api.pinterest.com/v5/boards. The old
// sandbox path used the app-owner token (PINTEREST_USER_ACCESS_TOKEN) which now
// 401s on list_boards — that was the bug. We now ALWAYS use the creator's own
// production token against api.pinterest.com. Sandbox path retired.
//
// Body: { look_id: string, board_name?: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_BASE = "https://api.pinterest.com/v5";  // production (app approved)
const SHOP_BASE = "https://shop.styledinmotion.studio";
const DEFAULT_BOARD = "My Styled in Motion Looks";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function pinterestCall(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body: parsed, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonRes({ error: "missing_auth" }, 401);
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonRes({ error: "invalid_jwt" }, 401);
  const creatorId = user.id;

  let body: { look_id?: string; board_name?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  if (!body.look_id) return jsonRes({ error: "missing_look_id" }, 400);
  const boardName = (body.board_name ?? DEFAULT_BOARD).slice(0, 180);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: tokenRow } = await admin
    .from("creator_pinterest_tokens")
    .select("access_token, expires_at, revoked_at, scopes, api_environment, pinterest_username")
    .eq("creator_id", creatorId)
    .maybeSingle();

  if (!tokenRow || !tokenRow.access_token || tokenRow.revoked_at) {
    return jsonRes({ error: "pinterest_not_connected" }, 400);
  }
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return jsonRes({ error: "token_expired", detail: "reconnect_required" }, 401);
  }
  const scopes: string[] = tokenRow.scopes ?? [];
  if (!scopes.includes("pins:write")) {
    return jsonRes({ error: "missing_write_scope", detail: "reconnect_required" }, 403);
  }

  // Production: the creator's own token does the read + write.
  const execToken = tokenRow.access_token;

  const { data: look } = await admin
    .from("looks")
    .select("id, creator_id, title, caption, hashtags, cover_photo_url")
    .eq("id", body.look_id)
    .maybeSingle();
  if (!look) return jsonRes({ error: "look_not_found" }, 404);
  if (look.creator_id !== creatorId) return jsonRes({ error: "not_your_look" }, 403);
  if (!look.cover_photo_url) return jsonRes({ error: "look_has_no_cover_image" }, 400);

  // Find or create the board
  let boardId: string | null = null;
  let bookmark: string | null = null;
  do {
    const path = bookmark
      ? `/boards?page_size=100&bookmark=${encodeURIComponent(bookmark)}`
      : "/boards?page_size=100";
    const r = await pinterestCall(execToken, "GET", path);
    if (r.status !== 200) return jsonRes({ error: `list_boards_${r.status}`, detail: r.text.slice(0, 300) }, 502);
    boardId = (r.body?.items ?? []).find((b: any) => b.name === boardName)?.id ?? null;
    bookmark = boardId ? null : (r.body?.bookmark ?? null);
  } while (!boardId && bookmark);

  if (!boardId) {
    const created = await pinterestCall(execToken, "POST", "/boards", {
      name: boardName,
      description: "Looks I styled on Styled in Motion — every piece is shoppable.",
      privacy: "PUBLIC",
    });
    if (created.status !== 201 || !created.body?.id) {
      return jsonRes({ error: `board_create_${created.status}`, detail: created.text.slice(0, 300) }, 502);
    }
    boardId = created.body.id;
  }

  const title = (look.title || "Styled on Styled in Motion").slice(0, 100);
  const hashtags = Array.isArray(look.hashtags) ? look.hashtags.slice(0, 6).map((h: string) => h.startsWith("#") ? h : `#${h}`).join(" ") : "";
  const description = [`${look.caption || look.title || "A look styled on Styled in Motion"}`, "Every piece is shoppable.", hashtags]
    .filter(Boolean).join(" ").slice(0, 780);
  const destination = `${SHOP_BASE}/look/${look.id}`;

  const pin = await pinterestCall(execToken, "POST", "/pins", {
    board_id: boardId,
    title,
    description,
    link: destination,
    alt_text: title.slice(0, 480),
    media_source: { source_type: "image_url", url: look.cover_photo_url },
  });

  if (pin.status !== 201 || !pin.body?.id) {
    console.error(`pin_create failed: ${pin.status} ${pin.text.slice(0, 300)}`);
    return jsonRes({ error: `pin_create_${pin.status}`, detail: pin.text.slice(0, 400) }, 502);
  }

  const { error: upsertErr } = await admin.from("pinterest_pins").upsert({
    creator_id: creatorId,
    pin_id: pin.body.id,
    board_id: boardId,
    title,
    description,
    image_url: look.cover_photo_url,
    link: destination,
    created_at_on_pinterest: pin.body.created_at ?? new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
  }, { onConflict: "creator_id,pin_id" });
  if (upsertErr) console.error(`pinterest_pins upsert failed: ${upsertErr.message}`);

  return jsonRes({
    ok: true,
    pin_id: pin.body.id,
    board_id: boardId,
    board_name: boardName,
    environment: "production",
    pin_url: `https://www.pinterest.com/pin/${pin.body.id}/`,
  });
});
