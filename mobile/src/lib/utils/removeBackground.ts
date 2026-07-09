/**
 * Client wrapper for the backend Photoroom-backed background removal endpoint.
 *
 * Production: gracefully falls back to the original image_url on any failure
 * so the UI never breaks. Dev: console.warns the cutout source so we can spot
 * silent fallbacks (X-Cutout-Source response header reports which path ran).
 */

const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
const isDev = process.env.NODE_ENV === 'development' || __DEV__;

export type RemoveBackgroundMode = 'bgRemove' | 'ghostMannequin' | 'flatLay';

export interface RemoveBackgroundResult {
  url: string;
  source: 'photoroom' | 'fallback' | 'unknown';
  mode: RemoveBackgroundMode;
}

export async function removeBackgroundDetailed(
  imageUrl: string,
  mode: RemoveBackgroundMode = 'bgRemove',
  prompt?: string,
): Promise<RemoveBackgroundResult> {
  if (!imageUrl) return { url: imageUrl, source: 'unknown', mode };
  if (!baseUrl) {
    console.warn('[removeBackground] EXPO_PUBLIC_BACKEND_URL not set, skipping');
    return { url: imageUrl, source: 'fallback', mode };
  }
  try {
    const r = await fetch(`${baseUrl}/api/remove-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, mode, ...(prompt ? { prompt } : {}) }),
    });
    const headerSource = (r.headers.get('X-Cutout-Source') ?? 'unknown').toLowerCase();
    if (!r.ok) {
      console.warn('[removeBackground] non-OK, falling back to original', r.status, headerSource);
      return { url: imageUrl, source: 'fallback', mode };
    }
    const json = await r.json();
    const url = json?.data?.cutout_photo_url ?? imageUrl;
    const bodySource = json?.data?.source as string | undefined;
    const source: RemoveBackgroundResult['source'] =
      bodySource === 'photoroom' || headerSource === 'photoroom'
        ? 'photoroom'
        : bodySource === 'fallback' || headerSource.startsWith('fallback')
          ? 'fallback'
          : 'unknown';
    if (isDev && source !== 'photoroom') {
      console.warn(`[removeBackground] cutout came from FALLBACK (X-Cutout-Source=${headerSource}). Photoroom did not run.`);
    }
    return { url, source, mode };
  } catch (e) {
    console.warn('[removeBackground] threw, falling back to original', e);
    return { url: imageUrl, source: 'fallback', mode };
  }
}

export async function removeBackground(
  imageUrl: string,
  mode: RemoveBackgroundMode = 'bgRemove',
  prompt?: string,
): Promise<string> {
  const { url } = await removeBackgroundDetailed(imageUrl, mode, prompt);
  return url;
}


/**
 * Pick the right Photoroom mode based on item category.
 *
 * - ghostMannequin: tuned for clothing photographed on a model. Strips the
 *   body and produces a "ghost mannequin" effect (clothing as if worn by an
 *   invisible body). Good for tops, dresses, outerwear.
 * - bgRemove: simple background removal. Preserves the entire foreground
 *   shape verbatim. Right choice for shoes, bags, jewelry, accessories, and
 *   anything not a body-worn garment — ghostMannequin AI tries to segment
 *   "garments" out of these photos and gets it wrong (e.g. earrings get split
 *   into pearl-only, pants get dropped when a model wears top + pants).
 *
 * When in doubt, default to bgRemove — it's the safer choice that preserves
 * the actual product shape.
 */
/**
 * Returns a Photoroom ghost mannequin prompt for categories that benefit from
 * nudging the AI toward isolating a specific garment type.
 */
export function pickCutoutPrompt(category: string | null | undefined): string | undefined {
  const c = (category ?? '').trim().toLowerCase();
  if (c === 'top' || c === 'tops') return 'isolate the top only, ignore pants and bottoms';
  if (c === 'dress' || c === 'dresses') return 'isolate the dress only';
  if (c === 'outerwear') return 'isolate the jacket or coat only';
  return undefined;
}

export function pickCutoutMode(category: string | null | undefined): RemoveBackgroundMode {
  const c = (category ?? '').trim().toLowerCase();
  if (c === 'top' || c === 'tops' || c === 'dress' || c === 'dresses' || c === 'outerwear') {
    return 'ghostMannequin';
  }
  // Pants, Shoes, Bag, Jewelry, Accessory, Other, and anything unrecognized
  // → bgRemove. ghostMannequin AI mis-segments multi-garment model photos
  // (drops pants when there's also a top) and breaks compound jewelry pieces
  // (earrings get reduced to one component). Simple bg removal is safer.
  return 'bgRemove';
}
