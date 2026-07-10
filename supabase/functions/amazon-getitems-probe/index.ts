// amazon-getitems-probe v2 — corrected to use itemIds field name.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AMAZON_API_BASE = "https://creatorsapi.amazon";
const MARKETPLACE = "www.amazon.com";
const PARTNER_TAG = Deno.env.get("AMAZON_PA_API_PARTNER_TAG") ?? "styledinmotio-20";

const TOKEN_FN_URL = `${SUPABASE_URL}/functions/v1/amazon-token`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getToken(): Promise<string> {
  const r = await fetch(TOKEN_FN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "apikey": SERVICE_ROLE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const b = await r.json();
  if (!b.access_token) throw new Error(`no token: ${JSON.stringify(b)}`);
  return b.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let itemIds: string[] = ["B09YCYYHB6"];
  try {
    const body = await req.json();
    if (Array.isArray(body.asins) && body.asins.length > 0) itemIds = body.asins;
    if (Array.isArray(body.itemIds) && body.itemIds.length > 0) itemIds = body.itemIds;
  } catch { /* default */ }

  let token: string;
  try { token = await getToken(); }
  catch (e) {
    return new Response(JSON.stringify({ error: "token_fail", detail: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const payload = {
    partnerTag: PARTNER_TAG,
    partnerType: "Associates",
    itemIds,
    marketplace: MARKETPLACE,
  };
  const r = await fetch(`${AMAZON_API_BASE}/catalog/v1/getItems`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-marketplace": MARKETPLACE,
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}

  return new Response(JSON.stringify({
    requested_item_ids: itemIds,
    request_payload: payload,
    status: r.status,
    ok: r.ok,
    response_json: json,
    response_text_excerpt: text.slice(0, 2000),
  }, null, 2), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
