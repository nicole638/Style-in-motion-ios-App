import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import type { ClothingItem } from '@/lib/state/lookStore';
import useAwinMerchantsStore from '@/lib/state/awinMerchantsStore';
import useClosetItemPreferencesStore from '@/lib/state/closetItemPreferencesStore';
import { hostFromUrl } from '@/lib/awin/wrap';
import { supabase } from '@/lib/supabase';

export const LOOK_URL_BASE = 'https://app.styledinmotion.app/look/';

export function buildLookShareUrl(lookId: string | null | undefined): string | null {
  if (!lookId) return null;
  return `${LOOK_URL_BASE}${lookId}`;
}

/**
 * Canonical share entry point for any creator-side "share a look" action.
 * Always surfaces the Universal Link so recipients deep-link back into the app.
 *
 * `message` carries caption + items + hashtags only (no URL) to avoid the iOS
 * rich-preview double-render: `url` renders as a preview card, `message` as body.
 */
export async function shareLook(args: {
  id: string | null | undefined;
  caption: string;
  items: ClothingItem[];
  hashtags?: string[];
}): Promise<void> {
  const { id, caption, items, hashtags } = args;
  const url = buildLookShareUrl(id);
  if (!url) {
    console.warn('[shareLook] missing look id — aborting share');
    return;
  }
  const offerLines = await buildOfferCaptionLines(items);
  const message = buildShareText({ caption, items, hashtags, offerLines });
  try {
    await Share.share({ url, message, title: 'Styled in Motion' });
  } catch (error) {
    console.warn('[shareLook] Share failed:', error);
  }
}

/**
 * For each item in the look whose merchant has an active Awin voucher offer
 * AND the user has toggled "auto-include in caption" on, return a single-line
 * promo blurb to append to the caption. Dedupes by voucher code so the same
 * code only appears once.
 */
export async function buildOfferCaptionLines(items: ClothingItem[]): Promise<string[]> {
  try {
    const store = useAwinMerchantsStore.getState();
    if (!store.loaded) await store.fetchActive();
    const prefStore = useClosetItemPreferencesStore.getState();
    if (!prefStore.hydrated) await prefStore.hydrate();

    // Collect candidate (item, merchant) pairs the user opted in for
    const candidates: { item: ClothingItem; merchantId: string; merchantName: string }[] = [];
    for (const item of items) {
      const enabled = useClosetItemPreferencesStore.getState().getAutoIncludeOffer(item.id);
      if (!enabled) continue;
      const host = item.link ? hostFromUrl(item.link) : null;
      if (!host) continue;
      const merchant = useAwinMerchantsStore.getState().findByHost(host);
      if (!merchant) continue;
      candidates.push({ item, merchantId: merchant.id, merchantName: merchant.name });
    }
    if (candidates.length === 0) return [];

    const uniqueMerchantIds = Array.from(new Set(candidates.map((c) => c.merchantId)));
    const todayISO = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('awin_offers')
      .select('merchant_id, type, title, voucher_code, start_date, end_date')
      .in('merchant_id', uniqueMerchantIds);
    if (error || !data) return [];

    // Pick the first active voucher per merchant
    const byMerchant = new Map<string, { title: string; code: string }>();
    for (const row of data as any[]) {
      if (row.type !== 'voucher' || !row.voucher_code) continue;
      if (row.start_date && row.start_date > todayISO) continue;
      if (row.end_date && row.end_date < todayISO) continue;
      const mid = String(row.merchant_id);
      if (!byMerchant.has(mid)) {
        byMerchant.set(mid, { title: row.title ?? '', code: row.voucher_code });
      }
    }

    const seenCodes = new Set<string>();
    const lines: string[] = [];
    for (const c of candidates) {
      const offer = byMerchant.get(c.merchantId);
      if (!offer) continue;
      if (seenCodes.has(offer.code)) continue;
      seenCodes.add(offer.code);
      const discount = shortDiscount(offer.title);
      const discountPart = discount ? ` for ${discount}` : '';
      lines.push(`Use code ${offer.code}${discountPart} at ${c.merchantName}!`);
    }
    return lines;
  } catch (e) {
    console.warn('[buildOfferCaptionLines] failed:', e);
    return [];
  }
}

function shortDiscount(title: string): string | null {
  const t = (title ?? '').trim();
  const pct = t.match(/(\d{1,2})\s*%\s*off/i);
  if (pct) return `${pct[1]}% off`;
  const dollar = t.match(/\$(\d{1,3})\s*off/i);
  if (dollar) return `$${dollar[1]} off`;
  return null;
}

/**
 * Build the caption + items + hashtags block used in the Instagram share flow.
 * Byte-identical to the previous inline template used across create.tsx (Step 4
 * and Step 5) and shop.tsx (detail modal).
 */
export function buildShareText(args: {
  caption: string;
  items: ClothingItem[];
  hashtags?: string[];
  /** Optional pre-built voucher promo lines, one per line, appended just before hashtags. */
  offerLines?: string[];
}): string {
  const { caption, items, hashtags, offerLines } = args;
  const itemsText = items.map(item => {
    let line = `${item.emoji} ${item.name}`;
    if (item.price) line += ` — $${item.price}`;
    if (item.brand) line += ` (${item.brand})`;
    if (item.primaryNote) line += ` (${item.primaryNote})`;
    if (item.link) line += `\n${item.link}`;
    for (const alt of (item.alternates ?? [])) {
      if (!alt?.link) continue;
      let altLine = alt.label ? `  ↳ ${alt.label}: ` : '  ↳ ';
      altLine += alt.name || 'Alternative';
      if (alt.price) altLine += ` — $${alt.price}`;
      if (alt.brand) altLine += ` (${alt.brand})`;
      altLine += `\n     ${alt.link}`;
      line += `\n${altLine}`;
    }
    return line;
  }).join('\n\n');
  const offersBlock = (offerLines && offerLines.length > 0)
    ? '\n\n' + offerLines.join('\n')
    : '';
  const hashtagsText = (hashtags ?? []).map(h => h.startsWith('#') ? h : '#' + h).join(' ');
  return `${caption}\n\n${itemsText}${offersBlock}\n\n${hashtagsText}`.trim();
}

async function toLocalUri(uri: string): Promise<string> {
  if (!uri.startsWith('http')) return uri;
  const dest = FileSystem.cacheDirectory + `ig-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { uri: localUri } = await FileSystem.downloadAsync(uri, dest);
  return localUri;
}

/**
 * Save a cover photo plus each item's photoUri into a named photo-library album.
 * Idempotent: if the album already exists, assets are appended.
 *
 * Resolves to the count of photos saved. Caller is responsible for requesting
 * MediaLibrary permission beforehand (this function checks the current status
 * and silently resolves to 0 if permission is not granted, matching the
 * previous inline behavior).
 */
export async function savePhotosToAlbum(args: {
  coverPhotoUri: string;
  items: ClothingItem[];
  albumName?: string;
}): Promise<number> {
  const { coverPhotoUri, items, albumName = 'Styled in Motion' } = args;

  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') return 0;

  const coverLocalUri = await toLocalUri(coverPhotoUri);
  const firstAsset = await MediaLibrary.createAssetAsync(coverLocalUri);
  const remainingAssets: MediaLibrary.Asset[] = [];

  for (const item of items) {
    if (item.photoUri) {
      const localUri = await toLocalUri(item.photoUri);
      const asset = await MediaLibrary.createAssetAsync(localUri);
      remainingAssets.push(asset);
    }
  }

  const album = await MediaLibrary.createAlbumAsync(albumName, firstAsset, false);
  if (remainingAssets.length > 0) {
    await MediaLibrary.addAssetsToAlbumAsync(remainingAssets, album, false);
  }

  return 1 + remainingAssets.length;
}
