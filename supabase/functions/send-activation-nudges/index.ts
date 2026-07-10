// send-activation-nudges — daily milestone nudge emails for creator activation.
// Stages (one nudge per creator per run, each nudge_key sent ONCE ever):
//   empty_closet: 0 closet items, signed up >= 2 days ago
//   first_look:   has items, 0 published looks, last item added >= 2 days ago
//   get_seen:     has published look(s), 0 clicks ever, latest publish >= 3 days ago
// Body: { dry_run?: boolean, preview_to?: string }
// Guard table: activation_nudges_log (creator_id, nudge_key) PK.
// NOTE: only account_type='creator' rows — shopper-closet accounts (account_type='shopper') are excluded.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("WELCOME_FROM_EMAIL") ?? "Styled in Motion <hello@styledinmotion.studio>";
const STUDIO_URL = "https://studio.styledinmotion.studio";
const MAX_SENDS_PER_RUN = 25;
const EXCLUDE_RE = /(@(styledtest\.com|testcreator\.com|applecreator\.com|styledinmotion\.app)$)|(^test)/i;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function wrap(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#faf8f5;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
    <p style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#1a1a1a;margin:0 0 32px;">Styled in Motion</p>
    ${inner}
    <hr style="border:none;border-top:1px solid #e5e0d8;margin:40px 0 16px;"/>
    <p style="font-size:12px;color:#999;line-height:1.5;">These little nudges stop on their own once you're rolling. Want them gone sooner? Just reply and say so — a real human reads these.</p>
  </div></body></html>`;
}

const btn = (href: string, label: string) =>
  `<p style="margin:0 0 24px;"><a href="${href}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;font-size:15px;letter-spacing:1px;">${label}</a></p>`;

function template(key: string, name: string): { subject: string; html: string } {
  if (key === "empty_closet") {
    return {
      subject: "Your closet's still empty — let's fix that in 90 seconds",
      html: wrap(`
        <h1 style="font-size:26px;font-weight:normal;line-height:1.3;margin:0 0 24px;">Hey ${name} — no judgment, but your closet is looking a little… minimalist.</h1>
        <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Here's the fastest fix we know: next time you're browsing literally anywhere on your phone, tap <strong>Share → Styled in Motion</strong>. That's it. The piece lands in your closet — cut out, cleaned up, and wearing your affiliate link.</p>
        <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">Or paste any product URL in your studio and we'll do the same magic there. One item is all it takes to get rolling — and yes, it starts earning from day one.</p>
        ${btn(STUDIO_URL + "/closet", "Add your first piece →")}
        <p style="font-size:16px;line-height:1.6;margin:0;">— Nicole &amp; Kerri</p>
      `),
    };
  }
  if (key === "first_look") {
    return {
      subject: "Those pieces you saved? They're dying to be styled",
      html: wrap(`
        <h1 style="font-size:26px;font-weight:normal;line-height:1.3;margin:0 0 24px;">Hey ${name} — your closet has pieces in it. Now comes the fun part.</h1>
        <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Open the collage builder, drop your pieces on the canvas, and arrange them like the magazine spread they deserve. The cutouts are already done — we handled that when you saved them.</p>
        <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">Creators tell us their first look takes under five minutes. And every piece in it carries <em>your</em> link.</p>
        ${btn(STUDIO_URL + "/collage", "Build your first look →")}
        <p style="font-size:16px;line-height:1.6;margin:0;">— Nicole &amp; Kerri</p>
      `),
    };
  }
  return {
    subject: "Your look is gorgeous. Now let's get it seen",
    html: wrap(`
      <h1 style="font-size:26px;font-weight:normal;line-height:1.3;margin:0 0 24px;">Hey ${name} — you published a look. It deserves an audience.</h1>
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Share it to Instagram, Pinterest, or TikTok straight from the look page — the share link keeps every piece shoppable with your affiliate links attached.</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">Our creators' biggest click days all start the same way: a look posted where their people already scroll. Your feed is the storefront — open the doors.</p>
      ${btn(STUDIO_URL, "Share your look →")}
      <p style="font-size:16px;line-height:1.6;margin:0;">— Nicole &amp; Kerri</p>
    `),
  };
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; detail?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  const body = await res.text();
  return res.ok ? { ok: true } : { ok: false, detail: `${res.status}: ${body.slice(0, 200)}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500 });

  let body: { dry_run?: boolean; preview_to?: string } = {};
  try { body = await req.json(); } catch { /* empty body = live run */ }

  if (body.preview_to) {
    const results: Record<string, unknown> = {};
    for (const key of ["empty_closet", "first_look", "get_seen"]) {
      const t = template(key, "Nicole");
      results[key] = await sendEmail(body.preview_to, `[PREVIEW] ${t.subject}`, t.html);
    }
    return new Response(JSON.stringify({ ok: true, preview_to: body.preview_to, results }), { headers: { "Content-Type": "application/json" } });
  }

  const [{ data: creators }, { data: items }, { data: looks }, { data: clicks }, { data: log }] = await Promise.all([
    supabase.from("creators").select("id, email, first_name, name, created_at").eq("account_type", "creator"),
    supabase.from("creator_items").select("creator_id, created_at"),
    supabase.from("looks").select("creator_id, published_at, archived"),
    supabase.from("click_events").select("creator_id"),
    supabase.from("activation_nudges_log").select("creator_id, nudge_key"),
  ]);

  const itemAgg = new Map<string, { n: number; last: number }>();
  for (const r of items ?? []) {
    const a = itemAgg.get(r.creator_id) ?? { n: 0, last: 0 };
    a.n++; a.last = Math.max(a.last, Date.parse(r.created_at));
    itemAgg.set(r.creator_id, a);
  }
  const lookAgg = new Map<string, { pub: number; lastPub: number }>();
  for (const r of looks ?? []) {
    if (r.archived || !r.published_at) continue;
    const a = lookAgg.get(r.creator_id) ?? { pub: 0, lastPub: 0 };
    a.pub++; a.lastPub = Math.max(a.lastPub, Date.parse(r.published_at));
    lookAgg.set(r.creator_id, a);
  }
  const clickAgg = new Map<string, number>();
  for (const r of clicks ?? []) clickAgg.set(r.creator_id, (clickAgg.get(r.creator_id) ?? 0) + 1);
  const sent = new Set((log ?? []).map((r) => `${r.creator_id}:${r.nudge_key}`));

  const now = Date.now();
  const D = 24 * 60 * 60 * 1000;
  const plan: Array<{ creator_id: string; email: string; name: string; nudge_key: string }> = [];

  for (const c of creators ?? []) {
    if (!c.email || EXCLUDE_RE.test(c.email.trim())) continue;
    const it = itemAgg.get(c.id);
    const lk = lookAgg.get(c.id);
    const ck = clickAgg.get(c.id) ?? 0;
    let key: string | null = null;
    if (!it && now - Date.parse(c.created_at) >= 2 * D) key = "empty_closet";
    else if (it && !lk && now - it.last >= 2 * D) key = "first_look";
    else if (lk && ck === 0 && now - lk.lastPub >= 3 * D) key = "get_seen";
    if (!key || sent.has(`${c.id}:${key}`)) continue;
    plan.push({ creator_id: c.id, email: c.email.trim(), name: (c.first_name || c.name || "there").split(" ")[0], nudge_key: key });
    if (plan.length >= MAX_SENDS_PER_RUN) break;
  }

  if (body.dry_run) {
    return new Response(JSON.stringify({ ok: true, dry_run: true, would_send: plan.length, plan: plan.map(p => ({ email: p.email, nudge: p.nudge_key })) }), { headers: { "Content-Type": "application/json" } });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const p of plan) {
    const t = template(p.nudge_key, esc(p.name));
    const r = await sendEmail(p.email, t.subject, t.html);
    if (r.ok) {
      await supabase.from("activation_nudges_log").insert({ creator_id: p.creator_id, nudge_key: p.nudge_key });
    }
    results.push({ email: p.email, nudge: p.nudge_key, ...r });
  }

  return new Response(JSON.stringify({ ok: true, sent: results.filter(r => r.ok).length, results }), { headers: { "Content-Type": "application/json" } });
});
