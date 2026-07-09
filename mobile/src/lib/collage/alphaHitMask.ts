/**
 * Alpha hit masks for shape-accurate collage hit testing.
 *
 * Each cutout URI is decoded ONCE (ever) into a tiny (≤64px max edge) alpha
 * map using Skia. The map is a Uint8Array of per-pixel alpha (0..255). We keep
 * only the alpha channel so the in-memory footprint is trivial (≤4KB per item)
 * and sampling on tap/drag-begin is a single array lookup — never a pixel read.
 *
 * The mask lets the canvas answer "is the finger over an opaque pixel of THIS
 * cutout, accounting for its transparent background?" so taps/drags fall
 * through transparent regions to whatever item sits beneath.
 */
import { Skia, AlphaType, ColorType } from '@shopify/react-native-skia';

export interface AlphaMask {
  w: number;
  h: number;
  /** data[y * w + x] = alpha 0..255 */
  data: Uint8Array;
}

/** Max edge (px) of the downscaled alpha map. Small enough to be cheap, large
 * enough to preserve silhouette accuracy for hit testing. Bumped 64→96 so thin
 * pieces (belts, straps, sunglasses arms) keep enough opaque rows to remain
 * grabbable — at 64px a thin strap can collapse below the sampling grid.
 * 96² alpha bytes ≈ 9KB per item: still trivial. */
const MAX_EDGE = 96;

// Decoded masks by URI. `null` means "decode failed" — cached so we never retry
// and so callers can treat the item as an opaque rectangle.
const cache = new Map<string, AlphaMask | null>();
// In-flight decodes, so concurrent callers for the same URI share one decode.
const inflight = new Map<string, Promise<AlphaMask | null>>();

async function decode(uri: string): Promise<AlphaMask | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    if (!data) return null;
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) return null;

    const iw = img.width();
    const ih = img.height();
    if (!iw || !ih) return null;

    const scale = Math.min(MAX_EDGE / iw, MAX_EDGE / ih, 1);
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));

    // CPU-backed offscreen surface (SRGB, Unpremul, RGBA_8888).
    const surface = Skia.Surface.Make(w, h);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.drawImageRect(
      img,
      Skia.XYWHRect(0, 0, iw, ih),
      Skia.XYWHRect(0, 0, w, h),
      Skia.Paint(),
      false
    );
    surface.flush();

    const snapshot = surface.makeImageSnapshot();
    const pixels = snapshot.readPixels(0, 0, {
      width: w,
      height: h,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    if (!pixels) return null;

    // pixels is RGBA_8888: 4 bytes per pixel, alpha at byte index 3.
    const count = w * h;
    const alpha = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      alpha[i] = pixels[i * 4 + 3] ?? 0;
    }
    return { w, h, data: alpha };
  } catch {
    return null;
  }
}

/**
 * Returns the alpha mask for a URI, decoding at most once ever. Resolves to
 * `null` when decoding fails (caller should then treat the item as an opaque
 * rectangle). Never throws.
 */
export async function getAlphaMask(uri: string): Promise<AlphaMask | null> {
  if (cache.has(uri)) return cache.get(uri) ?? null;
  const pending = inflight.get(uri);
  if (pending) return pending;

  const p = decode(uri)
    .catch(() => null)
    .then((mask) => {
      cache.set(uri, mask);
      inflight.delete(uri);
      return mask;
    });
  inflight.set(uri, p);
  return p;
}

/**
 * Samples the mask at normalized coords (u, v) in 0..1 over the image's own
 * bounds. Clamps to the edge; returns 0 for out-of-range input.
 */
export function sampleAlpha(mask: AlphaMask, u: number, v: number): number {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
  const x = Math.min(mask.w - 1, Math.max(0, Math.floor(u * mask.w)));
  const y = Math.min(mask.h - 1, Math.max(0, Math.floor(v * mask.h)));
  return mask.data[y * mask.w + x] ?? 0;
}

/**
 * Normalized (0..1) opaque bounding box of a mask — the tightest rectangle over
 * the image's own bounds that contains every pixel with alpha above `threshold`.
 * Used to shrink a cutout's selection frame to hug the garment silhouette
 * instead of the full (mostly-transparent) PNG rectangle. Returns the full
 * 0..1 box when the mask is empty/opaque so callers safely fall back to the
 * untrimmed frame. Pure — no side effects.
 */
export interface OpaqueBounds {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}

const boundsCache = new WeakMap<AlphaMask, OpaqueBounds>();

export function opaqueBounds(mask: AlphaMask, threshold = 13): OpaqueBounds {
  const cached = boundsCache.get(mask);
  if (cached) return cached;
  let minX = mask.w;
  let minY = mask.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.h; y++) {
    const row = y * mask.w;
    for (let x = 0; x < mask.w; x++) {
      if ((mask.data[row + x] ?? 0) > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  let result: OpaqueBounds;
  if (maxX < minX || maxY < minY) {
    result = { minU: 0, minV: 0, maxU: 1, maxV: 1 };
  } else {
    // +1 on the max edges so the box includes the last opaque pixel column/row.
    result = {
      minU: minX / mask.w,
      minV: minY / mask.h,
      maxU: (maxX + 1) / mask.w,
      maxV: (maxY + 1) / mask.h,
    };
  }
  boundsCache.set(mask, result);
  return result;
}
