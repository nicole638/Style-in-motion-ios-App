// TikTok Share Kit — Phase 1 + Phase 2 share entry point.
//
// Phase 1: Open the TikTok image composer pre-loaded with the cover photo
// via TikTokOpenSDK.share([coverPhotoUrl], true). The SDK wrapper does not
// support a caption arg, so we pre-copy the caption to clipboard before
// firing share() so the creator can paste it inside TikTok's editor.
//
// Phase 2: After a successful share, copy the short shop URL to clipboard
// and surface a nudge prompt instructing the creator to paste + pin the URL
// as a comment (TikTok hides external links from captions; pinned comments
// are the workaround).
//
// The IG Stories pattern (see shareLook.ts) writes to clipboard + opens the
// host app via URL scheme. This file mirrors that shape but adds the
// OpenSDK call between "save photo" and "open app" so creators land in the
// composer with the cover photo already attached.

import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { NativeModules, Platform } from 'react-native';
import TikTokOpenSDK from 'tiktok-opensdk-react-native';

import {
  buildTikTokCaption,
  buildShortShareLink,
  type TikTokCaptionLook,
} from '@/lib/share-captions';
import { downloadToCache } from '@/lib/utils/downloadToCache';

export interface TikTokShareLook extends TikTokCaptionLook {
  photoUri?: string | null;
}

export type TikTokShareOutcome =
  | { stage: 'missing-photo' }
  | { stage: 'permission-denied' }
  | { stage: 'cancelled'; clipboardUrl: string }
  | { stage: 'sdk-unavailable'; message: string }
  | { stage: 'shared'; clipboardUrl: string }
  | { stage: 'error'; message: string };

/**
 * Run the TikTok share flow. Caller is responsible for surfacing the
 * outcome in their UI (toast / banner / modal). The outcome carries the
 * short URL we copied to clipboard so callers can echo it into a Phase 2
 * nudge.
 */
export async function shareToTikTok(look: TikTokShareLook): Promise<TikTokShareOutcome> {
  console.log('[shareToTikTok] starting', {
    lookId: look.id,
    hasShortCode: !!look.shortCode,
    hasPhoto: !!look.photoUri,
    photoUri: look.photoUri?.slice(0, 80),
    urlScheme: 'tiktokopensdksbawoeu1u0o2strxye',
  });

  if (!look.photoUri) {
    console.log('[shareToTikTok] aborting — no photo');
    return { stage: 'missing-photo' };
  }

  // 1. Build the caption + copy to clipboard so the creator can paste it
  //    once inside TikTok's editor (the SDK doesn't accept a caption arg).
  const caption = buildTikTokCaption(look);
  console.log('[shareToTikTok] caption built', caption.slice(0, 120));
  try {
    await Clipboard.setStringAsync(caption);
    console.log('[shareToTikTok] caption written to clipboard');
  } catch (error) {
    console.warn('[shareToTikTok] clipboard caption copy failed:', error);
  }

  // 2. Photo permission. The SDK wrapper saves the file to the photo library
  //    ITSELF (that's how it obtains the PHAsset localIdentifier TikTok's
  //    native SDK actually shares), so it needs add-only permission — but we
  //    must NOT save the photo ourselves here, or it lands in Photos twice.
  //    Denied permission would otherwise surface as the SDK's opaque
  //    "Failed to save media" — catch it up front instead.
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    console.log('[shareToTikTok] media library permission (writeOnly):', status);
    if (status !== 'granted') {
      console.log('[shareToTikTok] aborting — photo permission denied');
      return { stage: 'permission-denied' };
    }
  } catch (error) {
    console.warn('[shareToTikTok] permissions check failed (non-fatal):', error);
  }

  // 3. Resolve a LOCAL file for the SDK. The wrapper's photo-library save
  //    chokes on remote https URLs ("Failed to save media") — published looks
  //    reopened later always have remote covers, so download to cache first.
  //    The temp file must outlive the share() call; cleanup happens in the
  //    finally below.
  let localUri: string = look.photoUri;
  let downloadedTemp: string | null = null;
  if (localUri.startsWith('/')) {
    // Bare path — caller-owned local file, just normalize. Not ours to delete.
    localUri = `file://${localUri}`;
  } else if (!localUri.startsWith('file://')) {
    const cached = await downloadToCache(localUri);
    if (!cached) {
      console.error('[shareToTikTok] cover download FAILED');
      return { stage: 'error', message: 'photo_download_failed' };
    }
    downloadedTemp = cached; // we created it (https/data: → cacheDirectory)
    localUri = cached;
    console.log('[shareToTikTok] cover resolved to local file', localUri.slice(-40));
  }

  // Pre-build the Phase 2 URL — we'll use it on both success AND cancel.
  // This is the bio-paste link (TikTok bios are the only tappable surface;
  // captions aren't clickable). Live app.styledinmotion.app/n link for now —
  // swap to buildStyledInShortLink once styled.in forwards short codes.
  const shareUrl = buildShortShareLink(look);
  console.log('[shareToTikTok] Phase 2 URL ready:', shareUrl);

  // 4. Fire the SDK with the LOCAL file. Returns { isSuccess: true } on
  //    success, otherwise an error object. iOS-only — the wrapper rejects on
  //    web/Android without the linked native module. Check native module
  //    registration first to avoid the SDK's internal console.error before
  //    it can even throw.
  if (!NativeModules.TiktokOpensdkReactNative) {
    console.log('[shareToTikTok] SDK unavailable — native module not linked');
    return { stage: 'sdk-unavailable', message: 'TikTok SDK requires a dev build (not Expo Go).' };
  }
  console.log('[shareToTikTok] calling SDK.share()');
  try {
    const result = await TikTokOpenSDK.share([localUri], /* isImage */ true, /* isGreenScreen */ false);
    console.log('[shareToTikTok] SDK resolved', JSON.stringify(result));

    if (result.isSuccess) {
      // 4. Phase 2: copy the URL to clipboard AFTER the SDK confirms
      //    success. This is the link the creator will pin as a comment.
      console.log('[shareToTikTok] Phase 2 — overwriting clipboard with URL', shareUrl);
      try {
        await Clipboard.setStringAsync(shareUrl);
      } catch (error) {
        console.warn('[shareToTikTok] clipboard URL copy failed:', error);
      }
      return { stage: 'shared', clipboardUrl: shareUrl };
    }

    // SDK returned a failure result. errorCode 0/empty often means user
    // cancelled the composer; treat that as a no-op but still write the
    // URL to clipboard so the creator can pin it if they re-share manually.
    const errorMessage = (result as { errorMsg?: string }).errorMsg ?? '';
    const errorCode = (result as any).errorCode;
    const subErrorCode = (result as any).subErrorCode;
    console.log('[shareToTikTok] SDK failure detail', {
      errorCode,
      subErrorCode,
      shareState: (result as any).shareState,
      errorMsg: errorMessage,
    });

    if (/cancel/i.test(errorMessage)) {
      console.log('[shareToTikTok] user cancelled — still writing URL to clipboard');
      try {
        await Clipboard.setStringAsync(shareUrl);
      } catch (error) {
        console.warn('[shareToTikTok] clipboard URL copy failed:', error);
      }
      return { stage: 'cancelled', clipboardUrl: shareUrl };
    }
    // Include the SDK's error codes so TestFlight reports are diagnosable
    // from the alert alone.
    const codeSuffix = errorCode !== undefined && errorCode !== null
      ? ` (code ${errorCode}${subErrorCode !== undefined && subErrorCode !== null ? `/${subErrorCode}` : ''})`
      : '';
    return { stage: 'error', message: `${errorMessage || 'TikTok share failed.'}${codeSuffix}` };
  } catch (error: any) {
    const message: string = error?.message ?? String(error);
    console.error('[shareToTikTok] SDK rejected', error);
    // The wrapper throws this exact prefix when the native module isn't
    // linked (e.g. running in Expo Go).
    if (message.includes("doesn't seem to be linked")) {
      return { stage: 'sdk-unavailable', message };
    }
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return { stage: 'sdk-unavailable', message: 'TikTok share is only supported on iOS and Android.' };
    }
    return { stage: 'error', message };
  } finally {
    // Clean up the cache temp only after the SDK call has fully resolved —
    // the wrapper reads the file during share(), so deleting earlier would
    // reintroduce the failure. Only files WE downloaded are deleted; a
    // caller-supplied file:// uri (fresh collage export) is left alone.
    if (downloadedTemp) {
      FileSystem.deleteAsync(downloadedTemp, { idempotent: true }).catch(() => {});
    }
  }
}
