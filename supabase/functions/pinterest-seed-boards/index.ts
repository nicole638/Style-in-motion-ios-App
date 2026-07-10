// pinterest-seed-boards v5 (2026-06-17) — removed the placeholder "Everyday
//   Denim" pin (fake look_id 11111111-aaaa…) that seeded a broken pin whose
//   /look/{id} destination 404s. No real look existed for it.
// v4 — added 2 boards aligned to Pinterest Trends:
//   - Denim Clothing Styles (+200% MoM)
//   - 2000s Yoga Mom Vibes (long-term trend for 2026)
// Existing 3 boards unchanged. Idempotent: re-running only creates new content.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PINTEREST_TOKEN = Deno.env.get("PINTEREST_USER_ACCESS_TOKEN") ?? "";
const API_BASE = Deno.env.get("PINTEREST_API_BASE") ?? "https://api-sandbox.pinterest.com/v5";
const SHOP_BASE = "https://shop.styledinmotion.studio";

interface PinSpec { look_id: string; title: string; description: string; }
interface BoardSpec { name: string; description: string; privacy: "PUBLIC" | "SECRET"; pins: PinSpec[]; }

const BOARDS: BoardSpec[] = [
  {
    name: "Spring Boho 2026 · Outfit Ideas",
    description: "Effortless boho outfits for spring — fringe, flow, denim, and festival-ready layers. Every look styled by a real creator on Styled in Motion, with every piece shoppable. #BohoFashion #SpringBoho #FestivalOutfit #StyledInMotion",
    privacy: "PUBLIC",
    pins: [
      { look_id: "7dee3a50-905d-4c86-ba44-9c4a608d09e3", title: "Boho Spring outfit — denim + linen layers", description: "Effortless spring boho — denim shorts, flowy top, layered jewelry. Easy day-to-night fit for festival season. Shop every piece on Styled in Motion. #BohoFashion #SpringBoho #OutfitInspo #FestivalOutfit #StyledInMotion" },
      { look_id: "ae026872-f50c-43a3-933f-47e7f621dc3f", title: "Country Festival outfit — boho meets western", description: "Country-festival ready: denim, fringe details, boho-edge accessories. Built for sunset shows and dusty fields. Tap to shop every piece. #WesternStyle #BohoFashion #FestivalOutfit #CountryConcertOutfit #StyledInMotion" },
      { look_id: "8f7b7844-0fce-470e-a1c6-868f02143d24", title: "Utility Chic boho take — for the in-between days", description: "Utility-meets-boho: relaxed silhouettes, earthy tones, work-to-weekend wearable. The capsule pieces every spring closet needs. #UtilityChic #BohoFashion #SpringOutfit #CapsuleWardrobe #StyledInMotion" },
      { look_id: "f21f8aa4-278e-440c-a764-336ecac97e2a", title: "Boho brunch outfit — soft layers + statement bag", description: "Soft boho brunch fit — cozy layers, earthy palette, weekend energy. Every piece shoppable on Styled in Motion. #BohoFashion #BrunchOutfit #SpringStyle #OutfitInspo #StyledInMotion" },
      { look_id: "fc53062b-398d-435e-9ae9-53534d3767c0", title: "Statement pants — boho conversation piece", description: "These pants spark a conversation. Boho-statement layered with neutral basics — bold but balanced. Tap to shop the whole fit. #BohoOutfit #StatementOutfit #FashionInspo #StyledInMotion" }
    ]
  },
  {
    name: "Date Night Outfit Ideas · Going Out",
    description: "Going-out looks that actually pull together — date night, girls night, party fits. Every outfit is styled by a real creator and every piece links to shop. #DateNightOutfit #GoingOutOutfit #PartyOutfit #StyledInMotion",
    privacy: "PUBLIC",
    pins: [
      { look_id: "49e915a6-24c1-4f88-b4d0-7b3a12eec0b7", title: "Date Night Vibes — black + rose details", description: "Effortless date night fit — black base, rose-tinted details, just-enough edge. Every piece shoppable. #DateNightOutfit #GoingOutOutfit #OOTD #FashionInspo #StyledInMotion" },
      { look_id: "b4fa118d-e284-42a7-8294-838ccce02c70", title: "Basic Black Dress — date night staple", description: "The black dress that does it all — date night, dinner, drinks. Minimal but elevated, the foundation every closet needs. #DateNightOutfit #BlackDressOutfit #CapsuleWardrobe #OutfitInspo #StyledInMotion" },
      { look_id: "0f1669c7-3090-4edc-9c48-3ed045720956", title: "Girls Night Out — glam + sporty mix", description: "Girls night fit that mixes glam with effortless — sneakers-with-the-dress energy. Easy to recreate, every piece linked. #GirlsNightOut #GoingOutOutfit #NightOutFit #OOTD #StyledInMotion" },
      { look_id: "1867b171-c981-4b54-b4a2-e833f99fc83d", title: "Casual Date Night — denim done right", description: "Date night without the dress code — elevated denim, edge accessories, just-enough effort. Tap to shop the whole look. #CasualDateNight #DateNightOutfit #DenimOutfit #StyledInMotion" },
      { look_id: "e43f75a6-3d69-4cca-84fd-87e7414ea2c2", title: "Party Time — full-glam going out fit", description: "Going-out glam without overdoing it — statement piece, polished base, ready for the night. #PartyOutfit #GoingOutOutfit #GlamOutfit #OutfitInspo #StyledInMotion" },
      { look_id: "64fb13a0-38a9-4317-a373-d0e33b2b78dc", title: "Black & Tan — summer date night", description: "Summer date night fit — black-and-tan palette, breezy fabrics, ready for golden hour. #SummerDateNight #DateNightOutfit #SummerOutfit #StyledInMotion" },
      { look_id: "f96393ef-3584-4e22-a94c-aa890f287ae1", title: "Spring fever — edgy spring date night", description: "Spring date night with edge — slightly unexpected, warm-weather wearable. Every piece shoppable. #SpringOutfit #DateNightOutfit #EdgyStyle #StyledInMotion" },
      { look_id: "c7efaa3c-896c-4e08-80e8-1475c30e6bce", title: "Work-to-night holiday party", description: "Office to evening — holiday party fit that earns the room. Polished, photographable, easy. #HolidayPartyOutfit #WorkToNight #PartyOutfit #StyledInMotion" }
    ]
  },
  {
    name: "Modern Minimalist Outfits · Quiet Luxury",
    description: "Quiet luxury made wearable. Clean lines, neutral palettes, pieces that look more expensive than they cost. Real creators, every outfit shoppable. #QuietLuxury #MinimalistOutfit #CleanGirl #StyledInMotion",
    privacy: "PUBLIC",
    pins: [
      { look_id: "ce53511b-631d-4e75-9546-9f8ec4d13588", title: "Tailored Minimalist — quiet luxury staple", description: "Tailored minimalist fit — clean lines, neutral palette, expensive-looking on a real budget. Every piece linked. #QuietLuxury #MinimalistOutfit #TailoredStyle #StyledInMotion" },
      { look_id: "4c720f3c-7de9-4967-be16-8e587dd964f3", title: "Monochromatic neutrals — easiest fit ever", description: "Monochromatic done right — one color story, three textures, instant pulled-together. The lazy-girl quiet luxury cheat. #MonochromaticOutfit #QuietLuxury #NeutralStyle #MinimalistFashion #StyledInMotion" },
      { look_id: "9b262173-db49-4021-8d89-8e8dcb0f71be", title: "Simple not basic — brunch fit", description: "Brunch fit with quiet-luxury polish — minimal pieces, considered details. Every link shoppable. #BrunchOutfit #MinimalistOutfit #QuietLuxury #WeekendStyle #StyledInMotion" },
      { look_id: "9564a0b8-d584-4e5a-bf95-07057b276a78", title: "Spring essentials — clean girl edit", description: "Spring essentials that read clean girl all the way through — neutrals, breathable layers, polished but not precious. #CleanGirlAesthetic #SpringOutfit #MinimalistFashion #StyledInMotion" },
      { look_id: "a9016a22-3be7-46a5-90c2-1eb6ede4ce3f", title: "Linen season — quiet vacation luxury", description: "Linen and neutrals for the in-between weather. Easy, breathable, polished — quiet luxury for everyday. #LinenOutfit #QuietLuxury #SpringStyle #SummerOutfit #StyledInMotion" },
      { look_id: "a6a74329-00da-4c12-8401-ff3294fb137c", title: "Lace details — soft minimalist work fit", description: "Lace details on a minimalist base — soft, polished, perfect for the office. The wear-anywhere fit. #WorkOutfit #MinimalistStyle #QuietLuxury #StyledInMotion" },
      { look_id: "20158efd-68d9-42cd-8e57-44664e4dccd3", title: "Utility Chic — minimalist with edge", description: "Utility chic — minimalist with a touch of edge. The capsule-piece fit that goes everywhere. #UtilityChic #MinimalistOutfit #CapsuleWardrobe #StyledInMotion" },
      { look_id: "28f7b32f-f030-4c49-89d0-f39cd03ba744", title: "Lavender Haze — minimalist with soft color", description: "Soft lavender on neutrals — the minimalist's accent color move. Easy, modern, photographable. #LavenderOutfit #MinimalistStyle #QuietLuxury #PastelOutfit #StyledInMotion" },
      { look_id: "ca226bd1-7ced-4bec-a275-1bc2f4bb0c2b", title: "Friday look — relaxed minimalist", description: "Friday fit — relaxed minimalist with brunch-to-evening flexibility. Every piece shoppable. #FridayOutfit #MinimalistFashion #WeekendStyle #StyledInMotion" },
      { look_id: "408901cd-0d60-40b7-9a0f-f2a939159ddc", title: "Simplistic — capsule wardrobe key piece", description: "The fit you'll repeat all season — simplistic but considered, the capsule wardrobe in action. #CapsuleWardrobe #MinimalistFashion #SimpleStyle #QuietLuxury #StyledInMotion" }
    ]
  },
  {
    name: "Denim Everything · Outfit Ideas",
    description: "Denim done every way — jeans + jacket Canadian tuxedos, chambray layers, the denim-as-neutral trick. Real creators, every piece shoppable. Pinterest trending +200% MoM. #DenimOutfit #DenimStyle #JeansOutfit #StyledInMotion",
    privacy: "PUBLIC",
    pins: [
      { look_id: "b86ec3a6-b0f6-4020-8c24-73f86dc4883f", title: "Denim Everything — head-to-toe denim outfit", description: "Full denim styled right — jacket, jeans, even the accents. The Canadian tuxedo you actually want to wear. Every piece shoppable on Styled in Motion. #DenimOutfit #DenimOnDenim #JeansOutfit #SpringStyle #StyledInMotion" },
      { look_id: "ab686370-45c4-403a-996a-7a89bb3932b6", title: "Denim as a neutral — wear it with everything", description: "Treating denim like a neutral is the styling cheat for spring. Pair with anything in your closet and it works. Tap to shop the fit. #DenimOutfit #DenimAsNeutral #MinimalistFashion #SpringOutfit #StyledInMotion" },
      { look_id: "1867b171-c981-4b54-b4a2-e833f99fc83d", title: "Casual Date Night — elevated denim", description: "Date night that doesn't need the dress code — dark denim, edge accessories, just-enough effort. Every piece linked. #DenimOutfit #CasualDateNight #DateNightDenim #StyledInMotion" },
      { look_id: "2c659dbf-8436-4411-a17a-178b35e28158", title: "Edgy denim outfit — dark wash + black layers", description: "Dark denim styled edgy — black layers on top, statement accessories. The fit that pulls double duty. #DenimOutfit #EdgyOutfit #DarkDenim #StyledInMotion" }
    ]
  },
  {
    name: "Y2K Yoga Mom Vibes · Pilates Princess",
    description: "2000s yoga mom aesthetic for 2026 — capris, soft athleisure, pilates-princess polish. Functional but feminine, sporty but styled. Trending on Pinterest for fashion + sport. #PilatesPrincess #YogaMom #Athleisure #Y2K #StyledInMotion",
    privacy: "PUBLIC",
    pins: [
      { look_id: "8fa32d60-9700-4217-b714-d5d6f2442493", title: "Boho Pilates Fit — yoga mom meets festival", description: "Pilates princess vibes with a soft boho overlay — the 2000s yoga mom aesthetic refreshed for 2026. Every piece shoppable. #PilatesPrincess #YogaMom #BohoAthleisure #Y2K #StyledInMotion" },
      { look_id: "7830203b-8457-4b87-9354-58d80952e465", title: "The look that moves — styled athleisure", description: "Athleisure that's actually styled — the look that goes from studio to coffee without changing. Pilates princess polish. #PilatesPrincess #Athleisure #YogaMom #SportyOutfit #StyledInMotion" },
      { look_id: "98cdc008-0820-4f7a-b963-853daf88e9c6", title: "Workout Essentials — yoga mom capsule", description: "The yoga mom capsule wardrobe done right — mix-and-match basics that work studio-to-day. #WorkoutOutfit #YogaMom #PilatesPrincess #ActiveWear #StyledInMotion" },
      { look_id: "25a113c5-9e63-40ae-971c-d4b8426ba788", title: "Sporty Y2K outfit — capris and crop", description: "Y2K athleisure done right — the capri-and-crop combo Pinterest is calling iconic 2000s yoga mom. #Y2K #YogaMom #CaprisOutfit #PilatesPrincess #StyledInMotion" },
      { look_id: "8df5cf80-d3fd-4364-a8b9-b31bcae20c04", title: "Daily athleisure — effortless yoga mom fit", description: "Athleisure that earns its place all day — soft, breathable, photographable. The 2026 yoga mom blueprint. #Athleisure #YogaMom #PilatesPrincess #DailyOutfit #StyledInMotion" },
      { look_id: "6611b311-8deb-4008-9a94-77d048af4ea2", title: "Pilates princess polish — sporty + soft", description: "Sporty styled soft — the pilates princess look that pulls together studio, errands, and casual coffee. #PilatesPrincess #Athleisure #YogaMom #SportyChic #StyledInMotion" },
      { look_id: "7588d3a3-a03b-42eb-8658-cc9364935a91", title: "Cozy athleisure — yoga mom for the in-between", description: "Cozy athleisure with yoga mom polish — the fit for crisp mornings, studio, and the rest of the day. #CozyAthleisure #YogaMom #PilatesPrincess #ComfortOutfit #StyledInMotion" },
      { look_id: "e560c941-0ec2-442f-9414-5553f91752b8", title: "Athletic chic — yoga mom for any errand", description: "Athletic chic styled to wear out — yoga mom aesthetic that works for coffee runs, school drop-off, anywhere. #AthleticOutfit #YogaMom #PilatesPrincess #StyledInMotion" }
    ]
  }
];

async function pinterestRequest(method: string, path: string, body?: unknown): Promise<{ status: number; body: any; text: string }> {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${PINTEREST_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body: parsed, text };
}

async function listAllBoards(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let bookmark: string | null = null;
  do {
    const path = bookmark ? `/boards?bookmark=${bookmark}&page_size=100` : "/boards?page_size=100";
    const r = await pinterestRequest("GET", path);
    if (r.status !== 200) break;
    for (const b of (r.body?.items ?? [])) {
      if (b.name) out.set(b.name, b.id);
    }
    bookmark = r.body?.bookmark ?? null;
  } while (bookmark);
  return out;
}

async function listPinDestinationsForBoard(boardId: string): Promise<Set<string>> {
  const out = new Set<string>();
  let bookmark: string | null = null;
  do {
    const path = bookmark ? `/boards/${boardId}/pins?bookmark=${bookmark}&page_size=100` : `/boards/${boardId}/pins?page_size=100`;
    const r = await pinterestRequest("GET", path);
    if (r.status !== 200) break;
    for (const p of (r.body?.items ?? [])) {
      if (p.link) out.add(p.link);
    }
    bookmark = r.body?.bookmark ?? null;
  } while (bookmark);
  return out;
}

Deno.serve(async () => {
  if (!PINTEREST_TOKEN) return new Response(JSON.stringify({ error: "PINTEREST_USER_ACCESS_TOKEN not set" }), { status: 500 });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const allLookIds = BOARDS.flatMap((b) => b.pins.map((p) => p.look_id));
  const { data: lookRows, error: lookErr } = await supa.from("looks")
    .select("id, cover_photo_url").in("id", allLookIds);
  if (lookErr) return new Response(JSON.stringify({ error: "lookup_failed", detail: lookErr.message }), { status: 500 });
  const coverByLookId = new Map<string, string>(
    (lookRows ?? []).filter((r: any) => r.cover_photo_url).map((r: any) => [r.id, r.cover_photo_url]),
  );

  const existingBoards = await listAllBoards();
  const results: any = { api_base: API_BASE, boards: [] };

  for (const board of BOARDS) {
    const boardResult: any = { name: board.name, pins_created: 0, pins_skipped: 0, errors: [] };

    let boardId = existingBoards.get(board.name) ?? null;
    if (!boardId) {
      const create = await pinterestRequest("POST", "/boards", { name: board.name, description: board.description, privacy: board.privacy });
      if (create.status === 201 && create.body?.id) {
        boardId = create.body.id;
        boardResult.created = true;
      } else {
        boardResult.error = `board_create_${create.status}: ${create.text.slice(0, 200)}`;
        results.boards.push(boardResult);
        continue;
      }
    } else {
      boardResult.reused = true;
    }
    boardResult.board_id = boardId;

    const existingPinLinks = await listPinDestinationsForBoard(boardId!);

    for (const pin of board.pins) {
      const destination = `${SHOP_BASE}/look/${pin.look_id}`;
      if (existingPinLinks.has(destination)) {
        boardResult.pins_skipped++;
        continue;
      }
      const imageUrl = coverByLookId.get(pin.look_id);
      if (!imageUrl) {
        boardResult.errors.push({ look_id: pin.look_id, error: "no_cover_image" });
        continue;
      }
      const create = await pinterestRequest("POST", "/pins", {
        board_id: boardId,
        title: pin.title.slice(0, 100),
        description: pin.description.slice(0, 800),
        link: destination,
        alt_text: pin.title.slice(0, 500),
        media_source: { source_type: "image_url", url: imageUrl },
      });
      if (create.status === 201 && create.body?.id) {
        boardResult.pins_created++;
      } else {
        boardResult.errors.push({ look_id: pin.look_id, status: create.status, detail: create.text.slice(0, 300) });
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    results.boards.push(boardResult);
  }

  return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
});
