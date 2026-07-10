// pinterest-probe v1 — one-shot validation of Pinterest API v5 access.
//
// Hits three endpoints with the production-limited token bound to Nicole's
// own Pinterest account, so we can confirm:
//   1. Auth works (token present + valid)
//   2. Granted scopes line up with what we expect (user_accounts/boards/pins)
//   3. Real response shapes match what we planned for in the strategy doc
//
// Run once via execute_sql + net.http_post, look at the response, then build
// the real integration.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TOKEN = Deno.env.get("PINTEREST_USER_ACCESS_TOKEN") ?? "";
const API_BASE = "https://api.pinterest.com/v5";

async function pinterestGet(path: string): Promise<{ status: number; body: any; text_excerpt: string }> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* may be empty */ }
  return { status: r.status, body, text_excerpt: text.slice(0, 600) };
}

Deno.serve(async () => {
  if (!TOKEN) {
    return new Response(
      JSON.stringify({ error: "PINTEREST_USER_ACCESS_TOKEN env var not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // 1. User account
  const user = await pinterestGet("/user_account");

  // 2. Boards list (first page, default 25)
  const boards = await pinterestGet("/boards?page_size=10");

  // 3. Pins from first board (if any)
  let firstBoardPins: any = null;
  let firstBoardId: string | null = null;
  let firstBoardName: string | null = null;
  if (boards.status === 200 && boards.body?.items?.length > 0) {
    firstBoardId = boards.body.items[0].id;
    firstBoardName = boards.body.items[0].name;
    firstBoardPins = await pinterestGet(`/boards/${firstBoardId}/pins?page_size=5`);
  }

  return new Response(
    JSON.stringify({
      user: {
        status: user.status,
        body: user.body,
      },
      boards: {
        status: boards.status,
        board_count: boards.body?.items?.length ?? 0,
        bookmark: boards.body?.bookmark ?? null,
        sample_items: boards.body?.items?.slice(0, 3) ?? null,
      },
      first_board: firstBoardId
        ? {
            id: firstBoardId,
            name: firstBoardName,
            pins_status: firstBoardPins?.status ?? null,
            pin_count_returned: firstBoardPins?.body?.items?.length ?? 0,
            sample_pins: firstBoardPins?.body?.items?.slice(0, 3) ?? null,
          }
        : null,
    }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
