import { useEffect, useState } from 'react';
import { Platform, type ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Rasterize Ionicons glyphs into image sources for the native Android bottom
 * tab bar.
 *
 * Why: `react-native-bottom-tabs` renders SF Symbols on iOS, but `sfSymbol` is
 * meaningless on Android's Material `BottomNavigationView` — it draws nothing.
 * So on Android we pre-rasterize the same glyphs the web tab bar uses into PNG
 * image sources and hand those to the native tabs.
 *
 * `Ionicons.getImageSource` returns a Promise; the native tab view mounts before
 * those resolve, so the icons are empty at first render (the reported "only the
 * active tab shows" bug). Callers should gate rendering of the navigator on the
 * returned `ready` flag so the bar renders once with icon + label, no flash.
 *
 * On iOS/web this is a no-op: `ready` is true immediately and `icons` stays
 * empty (callers use their own sfSymbol/web path there).
 *
 * `ready` flips true once every glyph settles (success OR failure) so a single
 * failed rasterization can never wedge the navigator on a blank loading state —
 * with `labeled` set, any missing icon still degrades to a visible label.
 */
export function useAndroidTabIcons(
  glyphs: Record<string, keyof typeof Ionicons.glyphMap>,
  opts?: { size?: number; color?: string },
): { icons: Record<string, ImageSourcePropType>; ready: boolean } {
  const size = opts?.size ?? 26;
  const color = opts?.color ?? '#1A1210';
  const [icons, setIcons] = useState<Record<string, ImageSourcePropType>>({});
  // Non-Android platforms never rasterize — ready from the first render.
  const [ready, setReady] = useState<boolean>(Platform.OS !== 'android');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    (async () => {
      const next: Record<string, ImageSourcePropType> = {};
      // Resolve each glyph independently so one failure doesn't drop the rest.
      await Promise.all(
        Object.entries(glyphs).map(async ([key, name]) => {
          try {
            const src = await Ionicons.getImageSource(name, size, color);
            if (src) next[key] = src;
          } catch {
            // Skip this glyph; `labeled` keeps its tab visible via the label.
          }
        }),
      );
      if (cancelled) return;
      setIcons(next);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // glyphs is defined inline at call sites; stringify so callers needn't memoize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, color, JSON.stringify(glyphs)]);

  return { icons, ready };
}

export default useAndroidTabIcons;
