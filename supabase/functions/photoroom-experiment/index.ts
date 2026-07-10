// photoroom-experiment — throwaway harness to A/B PhotoRoom recipes for the
// bottoms-cutout fix. POST {url, render, prompt?, negative?} → uploads the
// result to item-photos/phexp/ and returns the URL so it can be eyeballed.
// Does NOT touch creator_items. Delete after the recipe is chosen.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PR = Deno.env.get("PHOTOROOM_API_KEY")!;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function pr(form: FormData): Promise<{ status: number; bytes: Uint8Array }> {
  const r = await fetch("https://image-api.photoroom.com/v2/edit", {
    method: "POST", headers: { "x-api-key": PR }, body: form, signal: AbortSignal.timeout(60000),
  });
  const b = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, bytes: b };
}

function mkForm(bytes: Uint8Array, ctype: string, opts: Record<string, string>): FormData {
  const fd = new FormData();
  const ext = ctype.includes("png") ? "png" : ctype.includes("webp") ? "webp" : "jpg";
  fd.append("imageFile", new Blob([bytes], { type: ctype }), `s.${ext}`);
  fd.append("background.color", "transparent");
  for (const [k, v] of Object.entries(opts)) fd.append(k, v);
  return fd;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST", { status: 405 });
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "");
  const render = String(body.render ?? "ghost");
  const prompt = body.prompt ? String(body.prompt) : null;
  const negative = body.negative ? String(body.negative) : null;
  if (!/^https?:\/\//.test(url)) return new Response(JSON.stringify({ ok: false, error: "bad_url" }), { status: 400 });

  const ir = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  const ct = (ir.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
  const ib = new Uint8Array(await ir.arrayBuffer());

  const segOpts: Record<string, string> = { padding: "0.05", referenceBox: "originalImage" };
  if (prompt) segOpts["segmentation.prompt"] = prompt;
  if (negative) segOpts["segmentation.negativePrompt"] = negative;

  const steps: string[] = [];
  let out: Uint8Array;
  if (render === "ghost") {
    const r = await pr(mkForm(ib, ct, { "ghostMannequin.mode": "ai.auto" }));
    steps.push(`ghost:${r.status}:${r.bytes.length}`); out = r.bytes;
  } else if (render === "seg") {
    const r = await pr(mkForm(ib, ct, segOpts));
    steps.push(`seg:${r.status}:${r.bytes.length}`); out = r.bytes;
  } else if (render === "seg+ghost") {
    const r1 = await pr(mkForm(ib, ct, segOpts));
    steps.push(`seg:${r1.status}:${r1.bytes.length}`);
    const r2 = await pr(mkForm(r1.bytes, "image/png", { "ghostMannequin.mode": "ai.auto" }));
    steps.push(`ghost:${r2.status}:${r2.bytes.length}`); out = r2.bytes;
  } else {
    return new Response(JSON.stringify({ ok: false, error: "bad_render" }), { status: 400 });
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const key = `phexp/${Date.now()}-${render.replace("+", "_")}.png`;
  const { error } = await supa.storage.from("item-photos").upload(key, out, { contentType: "image/png", upsert: true });
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, steps, url: `${SUPABASE_URL}/storage/v1/object/public/item-photos/${key}` }), { headers: { "Content-Type": "application/json" } });
});
