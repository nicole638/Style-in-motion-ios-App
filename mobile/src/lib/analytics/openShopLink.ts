import * as WebBrowser from 'expo-web-browser';
import { CLICK_SOURCE } from '@/lib/analytics/source';

type OpenShopLinkArgs = {
  /** Raw destination URL (alternates, pasted links). URL-encoded internally. */
  url?: string | null;
  /** Published-look id (pairs with itemId). */
  lookId?: string | null;
  /** Look-item id (pairs with lookId). */
  itemId?: string | null;
  /** Closet/creator item id. */
  creatorItemId?: string | null;
  /** Owner/creator id — always include when known for better attribution. */
  creatorId?: string | null;
};

/**
 * Single source of truth for opening a shop link on iOS.
 *
 * Routes EVERY shop tap through the backend `/api/shop?...&source=` endpoint
 * (source = CLICK_SOURCE: 'ios' on iOS/web, 'android' on Android)
 * so the Amazon affiliate tag is stamped server-side AND the click_events row is
 * written server-side (with the tagged redirect_url). Callers must NOT also call
 * logClickEvent — that would recreate the untagged-row commission leak.
 *
 * Opens via WebBrowser.openBrowserAsync (SFSafariViewController) with the exact
 * options the already-correct paths use — NOT Linking.openURL.
 *
 * Guard: only routes when there's a real http(s) destination, or a look/item id
 * to resolve server-side. Falls back gracefully (raw url) if baseUrl is missing.
 */
export async function openShopLink(args: OpenShopLinkArgs): Promise<void> {
  const { url, lookId, itemId, creatorItemId, creatorId } = args;

  const rawUrl = url?.trim() || null;
  const hasRealUrl = !!rawUrl && /^https?:\/\//i.test(rawUrl);
  const hasIdContext = !!lookId || !!itemId || !!creatorItemId;

  // Nothing routable — bail without crashing.
  if (!hasRealUrl && !hasIdContext) return;

  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

  let target: string;
  if (baseUrl) {
    const params = new URLSearchParams();
    if (lookId) params.set('lookId', lookId);
    if (itemId) params.set('itemId', itemId);
    if (creatorItemId) params.set('creatorItemId', creatorItemId);
    if (hasRealUrl && rawUrl) params.set('url', rawUrl);
    if (creatorId) params.set('creatorId', creatorId);
    params.set('source', CLICK_SOURCE);
    target = `${baseUrl}/api/shop?${params.toString()}`;
  } else if (hasRealUrl && rawUrl) {
    // Backend URL missing — degrade gracefully to the raw destination rather
    // than crash. No tag stamped in this (dev-only) path, but the tap works.
    target = rawUrl;
  } else {
    // No baseUrl and no raw url to fall back to — can't route, don't crash.
    return;
  }

  await WebBrowser.openBrowserAsync(target, {
    toolbarColor: '#B87063',
    controlsColor: '#FFFFFF',
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
    dismissButtonStyle: 'done',
  });
}
