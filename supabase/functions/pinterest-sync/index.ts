// pinterest-sync v1 — pulls a connected creator's Pinterest boards + a
// sample of pins per board, AI-tags each pin image, computes a vibe
// signature per board, and writes everything to pinterest_boards +
// pinterest_pins for surfacing inside SiM.
//
// Cost / rate controls:
//   - PINS_PER_BOARD_SAMPLE (10) caps the number of pins we AI-tag per board
//   - We tag pin images in parallel batches of 4 to stay polite to OpenAI
//   - Skip already-tagged pins (idempotent re-runs only enrich new content)
//
// Token refresh is NOT in this v1 — if the token is expired, the EF
// returns an error so iOS can prompt the creator to reconnect. A separate
// pinterest-token-refresh EF + nightly cron handles refresh later.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const PROD_API_BASE = "https://api.pinterest.com/v5";
const SANDBOX_API_BASE = "https://api-sandbox.pinterest.com/v5";

const PINS_PER_BOARD_SAMPLE = 10;
const PARALLEL_TAG_BATCH = 4;

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

async function pinterestGet(apiBase: string, token: string, path: string): Promise<{ status: number; body: any; text: string }> {
  const r = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body: parsed, text };
}

type VibeTags = {
  style_vibe: string[];
  occasion: string[];
  color_palette: string[];
  clothing_type: string[];
  raw: any;
};

async function aiTagPinImage(imageUrl: string, title: string, description: string): Promise<VibeTags | null> {
  if (!OPENAI_KEY) return null;

  // Tight system prompt — same vocabulary the auto-tag-look v13 uses, so
  // Pinterest pins and SiM looks become directly comparable.
  const systemPrompt = `You are a fashion editor tagging a Pinterest pin for Styled in Motion. The tags will be used to match the pin against shoppable outfits.

Return ONLY valid JSON:
{
  "style_vibe": ["coquette", "minimalist", ...],
  "occasion": ["date night", "brunch", ...],
  "color_palette": ["black", "cream", ...],
  "clothing_type": ["dress", "boots", ...]
}

style_vibe preferred values: minimalist, romantic, edgy, classic, bohemian, sporty, glamorous, streetwear, preppy, vintage, trendy, cozy, coquette, coastal grandma, dark academia, cottagecore, balletcore, y2k, mob wife, quiet luxury, old money, western, athleisure, pilates princess, yoga mom, clean girl, french girl, soft girl, downtown girl.
occasion preferred values: casual, work, date night, night out, brunch, party, vacation, festival, athletic, everyday, school, weekend, wedding guest.

Rules: 1-5 values per array, lowercase. Be specific (prefer 'coquette' over 'trendy'). Infer from the image AND the pin's title/description.`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
              { type: "text", text: `Pin title: "${title || "none"}"\nPin description: "${description?.slice(0, 400) || "none"}"` },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    const norm = (a: any): string[] =>
      Array.isArray(a)
        ? a.filter((s: any) => typeof s === "string").map((s: string) => s.toLowerCase().trim()).filter((s) => s.length > 0).slice(0, 5)
        : [];
    return {
      style_vibe: norm(parsed.style_vibe),
      occasion: norm(parsed.occasion),
      color_palette: norm(parsed.color_palette),
      clothing_type: norm(parsed.clothing_type),
      raw: parsed,
    };
  } catch {
    return null;
  }
}

// Take the top 3 most-frequent style_vibe tags across an array of
// vibe-tagged pins. That becomes the board's vibe_signature.
function computeVibeSignature(tagsList: VibeTags[]): string[] {
  const counts = new Map<string, number>();
  for (const t of tagsList) {
    for (const v of t.style_vibe) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Load token
  const { data: tokenRow } = await admin
    .from("creator_pinterest_tokens")
    .select("access_token, expires_at, revoked_at, api_environment")
    .eq("creator_id", creatorId)
    .maybeSingle();

  if (!tokenRow || !tokenRow.access_token || tokenRow.revoked_at) {
    return jsonRes({ error: "pinterest_not_connected" }, 400);
  }
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return jsonRes({ error: "token_expired", detail: "reconnect_required" }, 401);
  }

  const apiBase = tokenRow.api_environment === "sandbox" ? SANDBOX_API_BASE : PROD_API_BASE;
  const token = tokenRow.access_token;

  // Open audit run
  const { data: run } = await admin.from("pinterest_sync_runs")
    .insert({ creator_id: creatorId }).select("id").single();
  const runId = run?.id ?? null;

  let boardsSeen = 0;
  let pinsSeen = 0;
  let pinsTagged = 0;
  let error: string | null = null;

  try {
    // 1. List all boards (paginate via bookmark)
    const allBoards: any[] = [];
    let bookmark: string | null = null;
    do {
      const path = bookmark
        ? `/boards?page_size=50&bookmark=${encodeURIComponent(bookmark)}`
        : "/boards?page_size=50";
      const r = await pinterestGet(apiBase, token, path);
      if (r.status !== 200) {
        error = `list_boards_${r.status}: ${r.text.slice(0, 200)}`;
        break;
      }
      for (const b of (r.body?.items ?? [])) allBoards.push(b);
      bookmark = r.body?.bookmark ?? null;
    } while (bookmark);

    if (error) throw new Error(error);
    boardsSeen = allBoards.length;

    // 2. For each board, pull a sample of pins, AI-tag the un-tagged ones,
    //    upsert, then compute the board's vibe_signature.
    for (const board of allBoards) {
      const boardId: string = board.id;
      const boardName: string = board.name ?? "";

      // Fetch a sample of pins
      const pinsResp = await pinterestGet(
        apiBase, token,
        `/boards/${boardId}/pins?page_size=${PINS_PER_BOARD_SAMPLE}`,
      );
      const pins: any[] = pinsResp.status === 200 ? (pinsResp.body?.items ?? []) : [];
      pinsSeen += pins.length;

      // Find which pins we've already tagged so we don't re-bill OpenAI
      const pinIds = pins.map((p) => p.id).filter(Boolean);
      let alreadyTaggedIds = new Set<string>();
      if (pinIds.length > 0) {
        const { data: existing } = await admin
          .from("pinterest_pins")
          .select("pin_id")
          .eq("creator_id", creatorId)
          .in("pin_id", pinIds)
          .not("ai_tags_generated_at", "is", null);
        alreadyTaggedIds = new Set((existing ?? []).map((r: any) => r.pin_id));
      }

      // AI-tag new pins in parallel batches
      const tagResults = new Map<string, VibeTags>();
      const toTag = pins.filter((p) => p.id && !alreadyTaggedIds.has(p.id) && p.media?.images?.["600x"]?.url);
      for (let i = 0; i < toTag.length; i += PARALLEL_TAG_BATCH) {
        const batch = toTag.slice(i, i + PARALLEL_TAG_BATCH);
        const tags = await Promise.all(batch.map(async (p) => {
          const imgUrl = p.media?.images?.["600x"]?.url || p.media?.images?.original?.url;
          if (!imgUrl) return null;
          const t = await aiTagPinImage(imgUrl, p.title ?? p.alt_text ?? "", p.description ?? "");
          return { pin: p, tags: t };
        }));
        for (const r of tags) {
          if (r && r.tags) {
            tagResults.set(r.pin.id, r.tags);
            pinsTagged++;
          }
        }
      }

      // Upsert all pins (including ones we didn't tag this run)
      const pinRows = pins.map((p) => {
        const tags = tagResults.get(p.id);
        const imageUrl = p.media?.images?.["600x"]?.url || p.media?.images?.original?.url || null;
        return {
          creator_id: creatorId,
          pin_id: p.id,
          board_id: boardId,
          title: p.title ?? p.alt_text ?? null,
          description: p.description ?? null,
          image_url: imageUrl,
          link: p.link ?? null,
          dominant_color: p.dominant_color ?? null,
          style_vibe: tags?.style_vibe ?? null,
          occasion: tags?.occasion ?? null,
          color_palette: tags?.color_palette ?? null,
          clothing_type: tags?.clothing_type ?? null,
          ai_tags_raw: tags?.raw ?? null,
          ai_tags_generated_at: tags ? new Date().toISOString() : null,
          created_at_on_pinterest: p.created_at ?? null,
          last_synced_at: new Date().toISOString(),
        };
      });
      if (pinRows.length > 0) {
        await admin.from("pinterest_pins")
          .upsert(pinRows, { onConflict: "creator_id,pin_id" });
      }

      // Compute board's vibe_signature from the tagged sample
      const taggedPinsForBoard = pinRows.filter((p) => p.style_vibe && p.style_vibe.length > 0);
      let vibeSignature: string[] = [];
      if (taggedPinsForBoard.length > 0) {
        vibeSignature = computeVibeSignature(
          taggedPinsForBoard.map((p) => ({
            style_vibe: p.style_vibe!, occasion: p.occasion ?? [],
            color_palette: p.color_palette ?? [], clothing_type: p.clothing_type ?? [], raw: null,
          })),
        );
      } else {
        // Re-derive from any previously-tagged pins so re-runs preserve signature
        const { data: priorTagged } = await admin
          .from("pinterest_pins")
          .select("style_vibe")
          .eq("creator_id", creatorId)
          .eq("board_id", boardId)
          .not("style_vibe", "is", null);
        if (priorTagged && priorTagged.length > 0) {
          vibeSignature = computeVibeSignature(
            priorTagged.map((r: any) => ({
              style_vibe: r.style_vibe ?? [], occasion: [], color_palette: [], clothing_type: [], raw: null,
            })),
          );
        }
      }

      // Upsert the board itself
      await admin.from("pinterest_boards").upsert({
        creator_id: creatorId,
        board_id: boardId,
        name: boardName,
        description: board.description ?? null,
        pin_count: board.pin_count ?? null,
        privacy: board.privacy ?? null,
        cover_image_url: board.media?.image_cover_url
          ?? board.media?.pin_thumbnail_urls?.[0]
          ?? null,
        vibe_signature: vibeSignature.length > 0 ? vibeSignature : null,
        pinterest_url: board.id ? `https://www.pinterest.com/${board.owner?.username ?? "_"}/${board.name?.toLowerCase().replace(/\s+/g, "-")}` : null,
        created_at_on_pinterest: board.created_at ?? null,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: "creator_id,board_id" });
    }
  } catch (e) {
    error = (e as Error).message;
  }

  if (runId) {
    await admin.from("pinterest_sync_runs")
      .update({
        completed_at: new Date().toISOString(),
        boards_seen: boardsSeen,
        pins_seen: pinsSeen,
        pins_tagged: pinsTagged,
        error_message: error,
      })
      .eq("id", runId);
  }

  return jsonRes({
    ok: !error,
    error,
    boards_seen: boardsSeen,
    pins_seen: pinsSeen,
    pins_tagged: pinsTagged,
  });
});
