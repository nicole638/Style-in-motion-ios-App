// pinterest-sandbox-demo — demonstrates Pin creation via Pinterest API v5 in the SANDBOX,
// as required for Standard access review. Hardcoded to the sandbox host; cannot touch
// production Pinterest content.
//
// Returns a full transcript of each API call (method, url, request body, status, response)
// plus a redacted curl equivalent — screen-record the invocation for the review video.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TOKEN = Deno.env.get("PINTEREST_USER_ACCESS_TOKEN") ?? "";
const HOOK_SECRET = Deno.env.get("WELCOME_HOOK_SECRET") ?? "";
const SANDBOX = "https://api-sandbox.pinterest.com/v5";

const DEMO_IMAGE = "https://rghlcnrttvlvphzahudf.supabase.co/storage/v1/object/sign/look-photos/covers/bf7c930c-5b07-41fc-9e7b-175654741925/1778686169871-gd55rip5x0b.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZDRjYmQyYS0zYjczLTQ5ZjktODEyYS1mYjJjMWZlYWMxNDMiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJsb29rLXBob3Rvcy9jb3ZlcnMvYmY3YzkzMGMtNWIwNy00MWZjLTllN2ItMTc1NjU0NzQxOTI1LzE3Nzg2ODYxNjk4NzEtZ2Q1NXJpcDV4MGIuanBnIiwiaWF0IjoxNzc4Njg2MTcxLCJleHAiOjIwOTQwNDYxNzF9.H6eSNvhMjiJbfjRlir1FDFirYZxLCklq8Frn-B4KUZA";
const DEMO_LINK = "https://shop.styledinmotion.studio/look/7dee3a50-905d-4c86-ba44-9c4a608d09e3";

interface Step {
  step: string;
  method: string;
  url: string;
  request_body?: unknown;
  status?: number;
  response_body?: unknown;
  curl_equivalent: string;
}

async function call(steps: Step[], step: string, method: string, path: string, body?: unknown) {
  const url = `${SANDBOX}${path}`;
  const curl = [
    `curl -X ${method} '${url}'`,
    `  -H 'Authorization: Bearer ***REDACTED***'`,
    `  -H 'Content-Type: application/json'`,
    body ? `  -d '${JSON.stringify(body)}'` : null,
  ].filter(Boolean).join(" \\\n");

  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 400); }
  steps.push({ step, method, url, request_body: body, status: r.status, response_body: parsed, curl_equivalent: curl });
  return { status: r.status, body: parsed as any };
}

Deno.serve(async (req: Request) => {
  if (!HOOK_SECRET || req.headers.get("x-demo-secret") !== HOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!TOKEN) {
    return new Response(JSON.stringify({ error: "PINTEREST_USER_ACCESS_TOKEN not set" }), { status: 500 });
  }

  const steps: Step[] = [];

  // 1. Verify identity/token against sandbox
  await call(steps, "1. Get user account (sandbox)", "GET", "/user_account");

  // 2. Find or create the demo board
  const boardName = "Styled in Motion · API Demo";
  const list = await call(steps, "2. List boards (sandbox)", "GET", "/boards?page_size=50");
  let boardId: string | null = null;
  if (list.status === 200) {
    boardId = (list.body?.items ?? []).find((b: any) => b.name === boardName)?.id ?? null;
  }
  if (!boardId) {
    const created = await call(steps, "3. Create board via API (sandbox)", "POST", "/boards", {
      name: boardName,
      description: "Board created programmatically via Pinterest API v5 sandbox by the Styled in Motion integration.",
      privacy: "PUBLIC",
    });
    if (created.status === 201) boardId = created.body?.id ?? null;
  }
  if (!boardId) {
    return new Response(JSON.stringify({ ok: false, error: "board_unavailable", transcript: steps }, null, 2), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  // 4. THE step the reviewer asked for: create a Pin via API call in the sandbox
  const pin = await call(steps, "4. CREATE PIN via API call (sandbox) — review requirement", "POST", "/pins", {
    board_id: boardId,
    title: "Boho Spring outfit — styled on Styled in Motion",
    description: "Pin created programmatically by the Styled in Motion Pinterest integration (API v5, sandbox). Every piece in the look is shoppable.",
    link: DEMO_LINK,
    alt_text: "Magazine-style fashion collage of a boho spring outfit",
    media_source: { source_type: "image_url", url: DEMO_IMAGE },
  });

  // 5. Read it back: list pins on the board
  await call(steps, "5. List pins on board (sandbox) — shows the created pin", "GET", `/boards/${boardId}/pins?page_size=10`);

  const ok = pin.status === 201;
  return new Response(JSON.stringify({
    ok,
    summary: ok
      ? `Pin ${pin.body?.id} created in Pinterest sandbox via POST /v5/pins`
      : `Pin creation returned ${pin.status} — see transcript`,
    created_pin_id: ok ? pin.body?.id : null,
    board_id: boardId,
    transcript: steps,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
