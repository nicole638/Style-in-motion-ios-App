// shareToPinterest.ts — opens Pinterest's PUBLIC create-pin share-intent
// (https://www.pinterest.com/pin/create/button) prefilled with the look's
// cover photo, the shopper look page as the destination link, and a
// shoppable description.
//
// This uses the creator's OWN logged-in Pinterest session — it does NOT touch
// SiM's Pinterest API app or access token, so the API app's Trial-access
// limit (which 403s pinterest-create-pin in production) does not apply. It
// works for EVERY creator immediately, whether or not they ever connected
// Pinterest inside SiM. Mirrors the web ShareLookMenu `sharePinterest`.
//
// The pinterest-create-pin Edge Function + OAuth flow stay in the repo for the
// future Standard-access API path, but are no longer invoked from the share
// button (see PinToPinterestRow).
//
// Pinterest's iOS app claims `pinterest.com` as a Universal Link, so opening
// this URL via Linking.openURL hands off to the Pinterest app if installed,
// falling back to the in-app browser otherwise. No native SDK required.
//
// We also save the cover photo to the camera roll (mirrors the IG / TikTok
// flows) so the creator can always attach it manually if the hand-off drops
// the image on a cold start.

import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';

import { type TikTokCaptionLook } from '@/lib/share-captions';
import { savePhotoToLibrary } from '@/lib/utils/savePhotoToLibrary';

export interface PinterestShareLook extends TikTokCaptionLook {
  photoUri?: string | null;
}

export type PinterestShareOutcome =
  | { stage: 'missing-photo' }
  | { stage: 'opened'; pinUrl: string; via: 'app' | 'browser'; destinationUrl: string }
  | { stage: 'error'; message: string };

// The pin's destination = the shopper look page, where product taps get
// affiliate-attributed. NOT the styled.in short link (which dead-ends when the
// app isn't installed). Same choice the web ShareLookMenu makes.
const SHOP_LOOK_BASE = 'https://shop.styledinmotion.studio/look/';
const MAX_DESCRIPTION = 480;
const MAX_HASHTAGS = 6;

/** Public shopper look page — the pin's destination + affiliate-attribution URL. */
export function buildShopLookUrl(look: PinterestShareLook): string {
  return look.id ? `${SHOP_LOOK_BASE}${look.id}` : 'https://shop.styledinmotion.studio';
}

/**
 * Pin description: caption (or title) + "Every piece is shoppable." + up to 6
 * hashtags, trimmed to ~480 chars (Pinterest caps at ~500).
 */
function buildPinDescription(look: PinterestShareLook): string {
  const base = (look.caption || look.title || 'A look from Styled in Motion').trim();
  const cta = 'Every piece is shoppable.';
  const withCta = base.length === 0 ? cta : base.endsWith('.') ? `${base} ${cta}` : `${base}. ${cta}`;
  const tags = (look.hashtags ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .slice(0, MAX_HASHTAGS);
  const full = tags.length > 0 ? `${withCta} ${tags.join(' ')}` : withCta;
  return full.slice(0, MAX_DESCRIPTION);
}

/**
 * Run the Pinterest share-intent flow. Opens Pinterest's create-pin screen
 * (app or web) prefilled with media + description + destination link. Returns
 * once the hand-off / in-app browser has been dismissed (or on failure).
 */
export async function shareToPinterest(
  look: PinterestShareLook,
): Promise<PinterestShareOutcome> {
  if (!look.photoUri) {
    return { stage: 'missing-photo' };
  }

  // Save the cover photo to the camera roll (best-effort) so the creator can
  // attach it manually if Pinterest drops it on hand-off. Never blocks share.
  try { await savePhotoToLibrary(look.photoUri); } catch {}

  const destinationUrl = buildShopLookUrl(look);
  const description = buildPinDescription(look);

  const params = new URLSearchParams();
  params.set('url', destinationUrl);
  params.set('media', look.photoUri);
  params.set('description', description);

  const pinUrl = `https://www.pinterest.com/pin/create/button/?${params.toString()}`;

  // Copy the destination link so the creator can paste it back if needed.
  try { await Clipboard.setStringAsync(destinationUrl); } catch {}

  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  // Try the Pinterest app first via Universal Link hand-off. Linking.openURL
  // lets iOS route pinterest.com URLs to the installed app; WebBrowser stays
  // inside Safari and never triggers the hand-off.
  try {
    await Linking.openURL(pinUrl);
    return { stage: 'opened', pinUrl, via: 'app', destinationUrl };
  } catch {
    // Fall through to in-app browser fallback.
  }

  try {
    await WebBrowser.openBrowserAsync(pinUrl, {
      controlsColor: '#E60023',
      toolbarColor: '#FFFFFF',
      dismissButtonStyle: 'close',
    });
    return { stage: 'opened', pinUrl, via: 'browser', destinationUrl };
  } catch (error: any) {
    return { stage: 'error', message: error?.message ?? String(error) };
  }
}
