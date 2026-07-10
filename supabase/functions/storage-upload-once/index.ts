// storage-upload-once — one-shot file upload EF for admin seeding.
// POST { bucket, path, content_type, base64 } → uploads to storage.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" }});
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  let body: { bucket?: string; path?: string; content_type?: string; base64?: string };
  try { body = await req.json(); } catch { return jsonRes({ error: "bad_json" }, 400); }
  if (!body.bucket || !body.path || !body.base64) {
    return jsonRes({ error: "missing_params", required: ["bucket", "path", "base64"] }, 400);
  }

  const bytes = b64ToBytes(body.base64);
  const ct = body.content_type ?? "image/png";
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { error } = await supa.storage.from(body.bucket)
    .upload(body.path, bytes, { contentType: ct, upsert: true, cacheControl: "86400" });
  if (error) return jsonRes({ error: "upload_failed", detail: error.message }, 500);

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${body.bucket}/${body.path}`;
  return jsonRes({ ok: true, bucket: body.bucket, path: body.path, bytes: bytes.length, public_url: publicUrl });
});
