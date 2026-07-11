import { useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * Run `refresh` when the screen gains focus AND every time the app returns to
 * the foreground while the screen is already focused.
 *
 * Plain `useFocusEffect` only fires on navigation focus/blur. That leaves a gap
 * for the iOS Share Extension: sharing a product adds it to the closet (via the
 * share-add-item edge function) while the app is BACKGROUNDED. When the user
 * comes back, the app foregrounds onto the SAME screen with no navigation
 * change — so a bare `useFocusEffect` never re-runs, and the realtime INSERT
 * that arrived while backgrounded is easily missed. The result was the papercut
 * where a freshly shared item only appeared after leaving the closet and
 * returning. Reloading on foreground-while-focused closes that gap.
 *
 * Pass a `refresh` wrapped in `useCallback` — the effect re-subscribes only when
 * `refresh`'s own dependencies change (same contract as the `useFocusEffect`
 * callback). The AppState listener is scoped to the focus lifetime, so a
 * blurred/backgrounded screen does no work.
 */
export function useFocusForegroundRefresh(refresh: () => void): void {
  useFocusEffect(
    useCallback(() => {
      // Reload immediately on focus (mount / tab switch / navigating back).
      refresh();

      // ...and again each time the app returns to the foreground while focused.
      // Mirrors the foreground-detection idiom used in lib/state/authStore.ts.
      let appState: AppStateStatus = AppState.currentState;
      const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
        const cameToForeground =
          /inactive|background/.test(appState) && next === 'active';
        appState = next;
        if (cameToForeground) refresh();
      });

      return () => sub.remove();
    }, [refresh]),
  );
}
