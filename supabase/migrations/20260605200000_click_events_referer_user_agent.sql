-- Capture HTTP Referer + User-Agent on every click_event so we can attribute
-- traffic by source channel (Instagram, Pinterest, direct, link previewers,
-- the shop.studio web app itself, etc.) and tell webview vs Safari vs Chrome
-- apart. The backend handler also infers `source='web'` from a non-null
-- Referer when no explicit ?src= query param is provided (so the
-- shop.styledinmotion.studio frontend "just works" without a deploy of its
-- own — and any new web entry points get the same auto-classification).
--
-- Privacy note: IP addresses are deliberately NOT captured. Referer and
-- User-Agent are standard request metadata appropriate for affiliate
-- attribution; if a stricter privacy posture is required at launch the
-- handler can mask the Referer query string before insert.
-- Applied to prod via Supabase MCP on 2026-06-05; this file mirrors it for VCS.
alter table public.click_events
  add column if not exists referer    text,
  add column if not exists user_agent text;

-- Index for grouping by referer host in analytics — partial so it's tiny.
create index if not exists click_events_referer_idx
  on public.click_events (referer)
  where referer is not null;
