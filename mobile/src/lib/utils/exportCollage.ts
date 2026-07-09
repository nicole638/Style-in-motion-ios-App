import { captureRef } from 'react-native-view-shot';

/**
 * Capture a JPEG of the supplied view ref. Defaults to 1080x1080 (square — the
 * collage canvas). Pass `{ width, height }` to capture a different size, e.g. a
 * portrait Style-a-Look hero (1080x1440). The caller is expected to pass a ref
 * attached to a root View whose on-screen aspect ratio matches the requested
 * dimensions; `captureRef` then resamples to width/height.
 */
export async function exportCollage(
  viewRef: unknown,
  opts?: { width?: number; height?: number },
): Promise<string> {
  // captureRef accepts a ref or a React component instance; the caller should
  // forward whatever ref the canvas exposes.
  return captureRef(viewRef as never, {
    format: 'jpg',
    quality: 0.95,
    width: opts?.width ?? 1080,
    height: opts?.height ?? 1080,
    result: 'tmpfile',
  });
}
