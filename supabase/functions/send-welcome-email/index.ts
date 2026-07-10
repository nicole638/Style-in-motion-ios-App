import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const HOOK_SECRET = Deno.env.get("WELCOME_HOOK_SECRET");
const FROM = Deno.env.get("WELCOME_FROM_EMAIL") ?? "Styled in Motion <hello@styledinmotion.studio>";

const STUDIO_URL = "https://studio.styledinmotion.studio";
// NOTE: the bare apex styledinmotion.studio does NOT resolve (verified 2026-07-02).
// The shopper site lives at shop.styledinmotion.studio — keep this pointed there.
const SHOP_URL = "https://shop.styledinmotion.studio";

function wrap(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#faf8f5;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
    <p style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#1a1a1a;margin:0 0 32px;">Styled in Motion</p>
    ${inner}
    <hr style="border:none;border-top:1px solid #e5e0d8;margin:40px 0 16px;"/>
    <p style="font-size:12px;color:#999;line-height:1.5;">You're getting this because you just created a Styled in Motion account. One welcome email — that's it, promise.</p>
  </div></body></html>`;
}

function creatorEmail(name: string) {
  return {
    subject: "Your closet just clocked in — welcome to Styled in Motion",
    html: wrap(`
      <h1 style="font-size:26px;font-weight:normal;line-height:1.3;margin:0 0 24px;">Hey ${name}, you're in.</h1>
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Here's our favorite thing to tell new creators: <strong>your affiliate links start earning from day one.</strong> No follower minimums. No waiting room. No fine print doing sneaky things.</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 8px;">Three things to do while the kettle's on:</p>
      <p style="font-size:16px;line-height:1.8;margin:0 0 24px;">
        <strong>1. Stock your closet</strong> — paste any merchant URL and we'll wrap the link, cut out the piece, and make it look editorial.<br/>
        <strong>2. Build a look</strong> — collage it like the magazine spread it deserves.<br/>
        <strong>3. Share it everywhere</strong> — IG, Pinterest, TikTok. Your looks, your links, your commissions.
      </p>
      <p style="margin:0 0 24px;"><a href="${STUDIO_URL}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;font-size:15px;letter-spacing:1px;">Open your studio →</a></p>
      <p style="font-size:16px;line-height:1.6;margin:0;">Stuck on anything? Just reply — a real human (hi!) reads these.</p>
      <p style="font-size:16px;line-height:1.6;margin:16px 0 0;">— Nicole &amp; Kerri</p>
    `),
  };
}

function shopperEmail(name: string) {
  return {
    subject: "Welcome to Styled in Motion — the good kind of scroll",
    html: wrap(`
      <h1 style="font-size:26px;font-weight:normal;line-height:1.3;margin:0 0 24px;">Hey ${name}, welcome.</h1>
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">You just unlocked the good kind of scroll: real looks styled by real creators — and every single piece is shoppable.</p>
      <p style="font-size:16px;line-height:1.8;margin:0 0 24px;">
        <strong>Find your people</strong> — browse creators by vibe, not by algorithm.<br/>
        <strong>Shop the look</strong> — tap any piece and go straight to the merchant.<br/>
        <strong>Skip the dupes</strong> — creators link the actual items they styled.
      </p>
      <p style="margin:0 0 24px;"><a href="${SHOP_URL}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;font-size:15px;letter-spacing:1px;">Start exploring →</a></p>
      <p style="font-size:16px;line-height:1.6;margin:0;">So glad you're here.</p>
      <p style="font-size:16px;line-height:1.6;margin:16px 0 0;">— The Styled in Motion team</p>
    `),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!HOOK_SECRET || req.headers.get("x-welcome-secret") !== HOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set");
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
  }

  let payload: { email?: string; first_name?: string; user_type?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const email = payload.email?.trim();
  if (!email) {
    return new Response(JSON.stringify({ error: "Missing email" }), { status: 400 });
  }

  const name = escapeHtml(payload.first_name?.trim() || "there");
  const isCreator = payload.user_type === "creator";
  const { subject, html } = isCreator ? creatorEmail(name) : shopperEmail(name);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [email], subject, html }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`Resend error ${res.status}: ${body}`);
    return new Response(JSON.stringify({ error: "Resend failed", status: res.status, detail: body }), { status: 502 });
  }

  console.log(`Welcome email sent to ${email} (${isCreator ? "creator" : "shopper"})`);
  return new Response(JSON.stringify({ ok: true, resend: JSON.parse(body) }), {
    headers: { "Content-Type": "application/json" },
  });
});
