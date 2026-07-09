// TikTok Share Kit — caption + link helpers
//
// Caption follows Nicole's approved format (2026-06: one hook line + link,
// NO hashtags, NO paragraph):
//   {hook}
//   {short link}
//
// LINK DOMAIN: we emit the live, known-working short link
// https://app.styledinmotion.app/n/{short_code} (the same redirect mobile has
// always used). Nicole asked for https://styled.in/{short_code} to match the
// web ShareLookMenu, BUT styled.in currently parks every path to /lander and
// does NOT forward short codes — shipping it today = broken links + lost
// affiliate attribution. `buildStyledInShortLink` below is ready; swap
// buildTikTokCaption + shareToTikTok onto it once the styled.in redirector is
// confirmed live in production.

const FALLBACK_HASHTAGS = ['StyledInMotion', 'OOTD', 'StyleInspo'];
const REQUIRED_HASHTAG = 'StyledInMotion';
const MAX_HASHTAGS = 5;

export interface TikTokCaptionLook {
  id?: string | null;
  title?: string | null;
  shortCode?: string | null;
  hashtags?: string[] | null;
  caption?: string | null;
}

/**
 * Returns the short shop URL for a look, preferring the 6-char hex short
 * code that resolves at app.styledinmotion.app/n/{code}. Falls back to the long
 * Universal Link when short_code is missing.
 */
export function buildShopUrl(look: TikTokCaptionLook): string {
  if (look.shortCode) {
    return `app.styledinmotion.app/n/${look.shortCode}`;
  }
  if (look.id) {
    return `app.styledinmotion.app/look/${look.id}`;
  }
  return 'app.styledinmotion.app';
}

/**
 * Picks up to 5 hashtags for the post. Always pins #StyledInMotion last so
 * we own the channel-discovery tag even when AI tags fill the slot quota.
 * Falls back to a curated default set when no AI tags are present.
 */
export function selectTikTokHashtags(look: TikTokCaptionLook): string[] {
  const raw = (look.hashtags ?? [])
    .map((tag) => (tag.startsWith('#') ? tag.slice(1) : tag))
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  const base = raw.length > 0 ? raw : FALLBACK_HASHTAGS.slice();

  // Drop any pre-existing #StyledInMotion (case-insensitive) so we can
  // re-append it at the end exactly once.
  const withoutRequired = base.filter(
    (tag) => tag.toLowerCase() !== REQUIRED_HASHTAG.toLowerCase()
  );

  // Reserve one slot for the required hashtag.
  const trimmed = withoutRequired.slice(0, MAX_HASHTAGS - 1);
  trimmed.push(REQUIRED_HASHTAG);
  return trimmed;
}

/**
 * The styled.in short link for a look — the same short link the web
 * ShareLookMenu copies. Redirects to the shopper look page
 * (shop.styledinmotion.studio/look/{id}) via the backend redirector.
 * Falls back to the long app link when short_code is missing so we never
 * hand the creator a bare/broken domain.
 */
export function buildStyledInShortLink(look: TikTokCaptionLook): string {
  if (look.shortCode) {
    return `https://styled.in/${look.shortCode}`;
  }
  if (look.id) {
    return `https://app.styledinmotion.app/look/${look.id}`;
  }
  return 'https://app.styledinmotion.app';
}

/**
 * Builds the caption we copy to clipboard before opening the TikTok composer.
 * The SDK doesn't accept a caption argument, so the creator pastes this into
 * TikTok's editor. Per Nicole (2026-06): ONE hook line + the styled.in link,
 * no hashtags. TikTok captions aren't clickable — the link is for
 * discovery/recall, and the "link in bio" nudge covers the tappable path.
 */
export function buildTikTokCaption(look: TikTokCaptionLook): string {
  const title = (look.title && look.title.trim()) || (look.caption && look.caption.trim()) || '';
  const hook = title ? `Styling: ${title} 🛍️` : 'Shop this look 🛍️';
  // Live working link today; switch to buildStyledInShortLink once styled.in
  // forwards short codes (see header note).
  return `${hook}\n${buildShortShareLink(look)}`;
}

/**
 * Long-form Universal Link for clipboard nudges. Matches LOOK_URL_BASE in
 * shareLook.ts but is always backed by the short_code redirect when present.
 */
export function buildShortShareLink(look: TikTokCaptionLook): string {
  if (look.shortCode) {
    return `https://app.styledinmotion.app/n/${look.shortCode}`;
  }
  if (look.id) {
    return `https://app.styledinmotion.app/look/${look.id}`;
  }
  return 'https://app.styledinmotion.app';
}
