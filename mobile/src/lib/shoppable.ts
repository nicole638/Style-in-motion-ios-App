// Single source of truth for "can this item actually be shopped?" — mirrors
// web/lib/affiliate.ts resolveOutboundUrl(), which returns null when neither
// affiliate_url nor url is usable. null, '', whitespace, and the legacy '#'
// placeholder all count as "no link" (some rows are '' rather than null).
//
// Linkless items are a FEATURE, not bad data — vintage, thrifted, gifted or
// personal pieces the creator styles but isn't selling. Surfaces keep them
// visible at reduced emphasis, never render a tappable Shop affordance for
// them, and never call /api/shop (the backend would just 404).
export function isShoppable(
  item: { link?: string | null; affiliate_url?: string | null } | null | undefined,
): boolean {
  if (!item) return false;
  const affiliate = (item.affiliate_url ?? '').trim();
  const link = (item.link ?? '').trim();
  return (affiliate.length > 0 && affiliate !== '#') || (link.length > 0 && link !== '#');
}

// Shopper-facing copy for linkless pieces. Reads as deliberate, never as an
// error — do not change to anything alarming or "coming soon"-flavored.
export const NOT_SHOPPABLE_LABEL = 'Not shoppable';
