// send-trr-campaign v3 — TheRealReal creator-collab emails via Resend.
// variants: 'launch' (sent 7/1), 'midmonth' (~7/15 nudge), 'lastcall' (~7/28 scarcity).
//   mode='test': { test_email, variant? } → one preview email ([TEST] subject).
//   mode='live': { confirm:'SEND-TRR-ALL', variant } → batch to ALL creators, ONCE.
// v3: recipients filtered to account_type='creator' (shopper-closet accounts share the creators table now).
// Idempotency: an atomic claim on public.trr_campaign_log(variant) makes a repeat
// (incl. the annual cron re-fire) a safe no-op. Guard token prevents accidental fire.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("WELCOME_FROM_EMAIL") ?? "Styled in Motion <hello@styledinmotion.studio>";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const FOOTER = (extra: string) => `<div style="border-top:1px solid #e7e3dd;padding-top:22px;text-align:center;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9a9a9a;">Styled in Motion</div><p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#a5a5a5;margin:16px 8px 0;">${extra} You're receiving this as a Styled in Motion creator.</p></div>`;

const CTA = `<div style="text-align:center;margin:0 0 34px;"><a href="https://www.therealreal.com/styledinmotion" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:2px;font-weight:bold;padding:16px 46px;text-transform:uppercase;">Consign Now</a></div>`;
const RULEBOX = `<div style="border:1px solid #1a1a1a;border-radius:6px;padding:14px 20px;text-align:center;margin:0 0 34px;"><span style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;">Style &amp; share the piece in the Styled in Motion app first, and use your <strong>Styled in Motion email</strong> on the form.</span></div>`;
const HEADER = `<div style="text-align:center;letter-spacing:2px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b6b6b;text-transform:uppercase;">Styled in Motion &nbsp;&times;&nbsp; The RealReal</div><div style="height:1px;background:#e7e3dd;margin:22px auto 30px;width:90px;"></div>`;
function shell(inner: string): string {
  return `<div style="margin:0;padding:0;background:#ffffff;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;"><div style="max-width:600px;margin:0 auto;padding:32px 28px 48px;">${HEADER}${inner}</div></div>`;
}

const FINE_LAUNCH = `Styled in Motion creator exclusive, 7/1&ndash;7/31/2026. Sell with The RealReal for the first time and receive a $250 site credit when you consign 1+ accepted item with a resale list price of $200+. You must be a Styled in Motion creator, have styled and shared the piece in the app, use the email associated with your Styled in Motion account, and consign through the link in the app. Cannot be combined with referral or first-time consignment credit. Credit delivered by email by the end of the month after you ship; expires 5 days from issue; not valid on shipping, prior purchases, or First Look. Non-transferable.`;
const FINE_SHORT = `Styled in Motion creator exclusive, ends 7/31/2026. First-time consignment, 1+ accepted item at $200+ resale list price. Must be a Styled in Motion creator, style &amp; share the piece in the app, use your Styled in Motion account email, and consign through the app link. Can't combine with referral or first-time credit. Credit by email by the end of the month after you ship; expires 5 days from issue.`;

const VARIANTS: Record<string, { subject: string; html: string }> = {
  launch: {
    subject: "Your closet is sitting on $250 💸",
    html: shell(
      `<div style="text-align:center;letter-spacing:3px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#1a1a1a;text-transform:uppercase;">Creator Exclusive &nbsp;·&nbsp; July Only</div>` +
      `<h1 style="text-align:center;font-weight:normal;font-size:40px;line-height:1.12;margin:18px 0 14px;">Your closet is<br/>sitting on <span style="white-space:nowrap;">$250.</span></h1>` +
      `<p style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#3a3a3a;margin:0 22px 26px;">Consign one designer piece through Styled in Motion this month and The RealReal pays you <strong>$250 in site credit</strong>.</p>` +
      `<div style="background:#F4D8CD;border-radius:6px;padding:20px 22px;text-align:center;margin:0 0 28px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#8a4a36;font-weight:bold;margin-bottom:6px;">$50 more than going direct</div><div style="font-size:19px;line-height:1.4;color:#2c231e;">The RealReal gives <strong>$200</strong> if you walk in their door. Come through <strong>your Styled in Motion app</strong> and it&rsquo;s <strong>$250</strong>. Same piece, same closet &mdash; fifty extra dollars for tapping the button.</div></div>` +
      CTA + RULEBOX + FOOTER(FINE_LAUNCH)
    ),
  },
  midmonth: {
    subject: "Two weeks left on your $250 💸",
    html: shell(
      `<div style="text-align:center;letter-spacing:3px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#1a1a1a;text-transform:uppercase;">Two Weeks Left &nbsp;·&nbsp; Ends 7/31</div>` +
      `<h1 style="text-align:center;font-weight:normal;font-size:38px;line-height:1.14;margin:18px 0 14px;">Two weeks left.<br/>Your <span style="white-space:nowrap;">$250</span> is still here.</h1>` +
      `<p style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#3a3a3a;margin:0 20px 26px;">Half the month&rsquo;s gone &mdash; the credit hasn&rsquo;t. If there&rsquo;s a bag or a blazer you never reach for, consider this your sign.</p>` +
      `<div style="background:#F4D8CD;border-radius:6px;padding:18px 22px;text-align:center;margin:0 0 28px;"><div style="font-size:18px;line-height:1.45;color:#2c231e;">Consign one designer piece through <strong>your Styled in Motion app</strong> and The RealReal pays you <strong>$250 in credit</strong> &mdash; <strong>$50 more</strong> than going to them direct.</div></div>` +
      CTA + RULEBOX + FOOTER(FINE_SHORT)
    ),
  },
  lastcall: {
    subject: "Last call: your $250 disappears 7/31",
    html: shell(
      `<div style="text-align:center;letter-spacing:3px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#8a4a36;text-transform:uppercase;">Final Days &nbsp;·&nbsp; Ends 7/31</div>` +
      `<h1 style="text-align:center;font-weight:normal;font-size:38px;line-height:1.14;margin:18px 0 14px;">Last call.<br/>The <span style="white-space:nowrap;">$250</span> is gone after 7/31.</h1>` +
      `<p style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#3a3a3a;margin:0 20px 26px;">This is it. After the 31st, the first-timer credit disappears. Got a designer piece on the list collecting dust? <strong>Now or never.</strong></p>` +
      `<div style="background:#F4D8CD;border-radius:6px;padding:18px 22px;text-align:center;margin:0 0 28px;"><div style="font-size:18px;line-height:1.45;color:#2c231e;">One first-time consignment, one <strong>$200+</strong> designer piece &mdash; <strong>$250 in site credit</strong>. Same closet, fifty extra dollars for coming through the app.</div></div>` +
      CTA + RULEBOX + FOOTER(FINE_SHORT)
    ),
  },
};

async function resendSend(payload: unknown, batch: boolean): Promise<{ ok: boolean; status: number; body: string }> {
  const r = await fetch(`https://api.resend.com/emails${batch ? "/batch" : ""}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  if (!RESEND_API_KEY) return jsonRes({ error: "RESEND_API_KEY not configured" }, 500);

  let body: { mode?: string; test_email?: string; variant?: string; confirm?: string; limit?: number };
  try { body = await req.json(); } catch { return jsonRes({ error: "bad_json" }, 400); }

  const variant = (body.variant ?? "launch").trim().toLowerCase();
  const v = VARIANTS[variant];
  if (!v) return jsonRes({ error: "invalid_variant", got: variant, valid: Object.keys(VARIANTS) }, 400);
  const mode = body.mode ?? (body.test_email ? "test" : "live");

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (mode === "test") {
    const to = body.test_email?.trim();
    if (!to) return jsonRes({ error: "missing_test_email" }, 400);
    const r = await resendSend({ from: FROM, to: [to], subject: `[TEST] ${v.subject}`, html: v.html }, false);
    return jsonRes({ ok: r.ok, mode: "test", variant, to, subject: `[TEST] ${v.subject}`, from: FROM, resend_status: r.status, resend: r.body.slice(0, 300) }, r.ok ? 200 : 502);
  }

  if (body.confirm !== "SEND-TRR-ALL") {
    return jsonRes({ error: "live_send_requires_confirm", hint: 'POST { "mode":"live", "variant":"midmonth", "confirm":"SEND-TRR-ALL" }' }, 400);
  }

  // Atomic send-once claim: insert the variant row; a duplicate = already sent → no-op.
  const { error: claimErr } = await supa.from("trr_campaign_log").insert({ variant, recipient_count: 0 });
  if (claimErr) {
    return jsonRes({ ok: true, mode: "live", variant, skipped: true, reason: "already_sent" });
  }

  // v3: creators ONLY — shopper-closet accounts live in the same table now.
  const { data: creators, error } = await supa.from("creators").select("email").eq("account_type", "creator").not("email", "is", null);
  if (error) return jsonRes({ error: "creators_query_failed", detail: error.message }, 500);
  const recipients = Array.from(new Set(
    (creators ?? []).map((c) => (c.email as string ?? "").trim().toLowerCase()).filter((e) => e.includes("@"))
  ));
  const list = typeof body.limit === "number" ? recipients.slice(0, body.limit) : recipients;
  if (list.length === 0) return jsonRes({ error: "no_recipients" }, 400);

  const r = await resendSend(list.map((to) => ({ from: FROM, to: [to], subject: v.subject, html: v.html })), true);
  await supa.from("trr_campaign_log").update({ recipient_count: list.length, sent_at: new Date().toISOString() }).eq("variant", variant);
  return jsonRes({ ok: r.ok, mode: "live", variant, recipient_count: list.length, subject: v.subject, from: FROM, resend_status: r.status, resend: r.body.slice(0, 600) }, r.ok ? 200 : 502);
});
