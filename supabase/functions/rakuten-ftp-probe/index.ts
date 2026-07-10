// rakuten-ftp-probe — minimal Deno TCP FTP probe.
// Tries to authenticate against aftp.linksynergy.com:21 and list the root directory.
// If this works from an EF (it didn't work from the sandbox test runner due to
// IP rate-limiting), the path forward is a Supabase-native FTP bridge instead
// of an external Vercel/GitHub Actions service.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Send a single line to the FTP control connection and read the response. */
async function ftpCmd(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  cmd: string | null,
): Promise<string> {
  if (cmd) {
    await writer.write(new TextEncoder().encode(cmd + "\r\n"));
  }
  const decoder = new TextDecoder();
  let buf = "";
  // Read until we see a complete reply (line ending in CRLF, with leading 3-digit code).
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // FTP responses end with "<code> <text>\r\n" or multi-line "<code>-...\r\n<code> ...\r\n"
    const lines = buf.split("\r\n");
    const last = lines[lines.length - 2] ?? "";  // last complete line
    if (last && /^\d{3}\s/.test(last)) return buf.trim();
    if (lines.length > 1 && lines[0].length >= 4 && lines[0][3] !== "-") return buf.trim();
  }
  return buf.trim();
}

Deno.serve(async (_req: Request) => {
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: cfg } = await supa.from("rakuten_publisher_config")
    .select("sftp_host, sftp_user, sftp_pass").eq("is_default", true).maybeSingle();
  if (!cfg?.sftp_pass) {
    return new Response(JSON.stringify({ error: "no_creds" }), { status: 500 });
  }

  const host = cfg.sftp_host ?? "aftp.linksynergy.com";
  const user = cfg.sftp_user ?? "";
  const pass = cfg.sftp_pass ?? "";

  let conn: Deno.TcpConn;
  const events: Array<{ step: string; out: string }> = [];

  try {
    conn = await Deno.connect({ hostname: host, port: 21, transport: "tcp" });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, step: "connect", error: String(e) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();

    events.push({ step: "banner", out: await ftpCmd(reader, writer, null) });
    events.push({ step: "USER", out: await ftpCmd(reader, writer, `USER ${user}`) });
    const passResp = await ftpCmd(reader, writer, `PASS ${pass}`);
    events.push({ step: "PASS", out: passResp });

    const authenticated = /^230\b/.test(passResp);
    if (authenticated) {
      events.push({ step: "TYPE I", out: await ftpCmd(reader, writer, "TYPE I") });
      events.push({ step: "PWD",    out: await ftpCmd(reader, writer, "PWD") });
    }
    await ftpCmd(reader, writer, "QUIT").catch(() => null);

    return new Response(JSON.stringify({
      ok: authenticated,
      authenticated,
      host,
      user,
      events,
      egress_note: "This response is what Supabase egress IP sees from Rakuten FTP. If 530 → IP block. If 230 → we can build a Deno FTP bridge.",
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  } finally {
    try { conn.close(); } catch { /* */ }
  }
});
