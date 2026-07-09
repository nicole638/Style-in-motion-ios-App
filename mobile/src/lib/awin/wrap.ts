// URL host normalization + Awin click-tracker wrapping. Mirrors web at
// creators-web/lib/awin/wrap.ts. Backend /api/shop already handles the wrapped
// shape (see backend/src/routes/shop-redirect.ts) — we just build the URL here
// so the click attributes to the right creator on the very first save.

const AWIN_PUBLISHER_ID = '2891857';

export function normalizeHost(rawHost: string): string {
  return rawHost.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
}

export function hostFromUrl(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

export function isAwinWrapped(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      (host === 'awin1.com' || host === 'www.awin1.com') &&
      u.pathname.startsWith('/cread.php')
    );
  } catch {
    return false;
  }
}

export function buildAwinUrl(opts: {
  awinmid: number | string | null;
  clickref: string;
  productUrl: string;
}): string {
  // Rakuten merchants have no awinmid — we can't build an Awin tracking URL for them.
  // Bail with the raw URL and a log so callers see it. Rakuten product catalog (SFTP)
  // is not yet enabled so in practice this path is only hit by AwinMatchBanner when a
  // creator pastes a Rakuten-merchant host into the Add Item flow. Until we wire the
  // affiliate-wrap-url Edge Function, returning raw URL means the click goes through
  // unwrapped — better than producing a broken Awin URL with awinmid=null.
  if (opts.awinmid === null || opts.awinmid === undefined || opts.awinmid === '' || opts.awinmid === 0) {
    console.log('[buildAwinUrl] no awinmid (likely rakuten merchant) — returning raw URL');
    return opts.productUrl;
  }
  const params = new URLSearchParams({
    awinmid: String(opts.awinmid),
    awinaffid: AWIN_PUBLISHER_ID,
    clickref: opts.clickref,
    p: opts.productUrl,
  });
  return `https://www.awin1.com/cread.php?${params.toString()}`;
}
