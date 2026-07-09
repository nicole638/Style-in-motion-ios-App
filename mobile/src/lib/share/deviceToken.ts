// Share-extension device token lifecycle (app/JS side of "Share → Styled in
// Motion").
//
// A share extension runs while the app is closed, so a 1-hour access token would
// be stale. Instead we mint a LONG-LIVED device token (tied to the creator via
// issue_share_device_token) ONCE, keep it across sessions, and mirror it into a
// shared App Group container so the native extension can read it and POST to the
// share-add-item edge function. We mint only when none is stored — rotating on
// every open is wasteful (each mint revokes the prior token).
//
// The App Group write itself is native (UserDefaults(suiteName:)). This module
// talks to a tiny native module (`SimSharedDefaults`) that the iOS app exposes;
// until that native target ships it no-ops gracefully — the token is still
// minted and stored locally, only the cross-process mirror waits on the native
// shim. See the share-extension setup notes for the entitlement + module.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';

// Warn at most once so we don't spam on every auth event / app foreground.
let warnedMirrorModuleMissing = false;

const appVersion: string | null =
  (Constants.expoConfig?.version as string | undefined) ??
  (Constants as unknown as { nativeAppVersion?: string }).nativeAppVersion ??
  null;

// Runtime diagnostic beacon (WRITE side). Fire-and-forget insert into
// public.share_beacon so we can see server-side whether the mirror path ran and
// whether the native module was present — the extension writes the READ-side
// beacon. See supabase/migrations/20260709030000_share_beacon.sql for the full
// discriminator table. Shipped builds only: in dev the native module is
// intentionally absent (Expo Go), so a beacon there is just noise. Never throws.
function postAppBeacon(fields: {
  module_present: boolean;
  write_returned: boolean;
  note?: string;
}): void {
  if (__DEV__ || Platform.OS !== 'ios') return;
  void supabase
    .from('share_beacon')
    .insert({
      side: 'app_write',
      app_group: SHARE_APP_GROUP,
      module_present: fields.module_present,
      write_returned: fields.write_returned,
      build: appVersion,
      note: fields.note ?? null,
    })
    .then(({ error }) => {
      if (error) console.warn('[share-token] beacon insert failed', error.message);
    });
}

// Local cache key (app-sandboxed AsyncStorage — NOT shared with the extension).
const STORAGE_KEY = 'sim_share_token';

// Shared App Group. MUST match the entitlement on BOTH the app and the share
// extension target (set on the native/EAS side). Keep this string in sync there.
export const SHARE_APP_GROUP = 'group.studio.styledinmotion';
const APP_GROUP_KEY = 'sim_share_token';

// Native seam. The iOS app should expose a module with this shape that writes to
// UserDefaults(suiteName:). Resolved defensively so the JS lifecycle works (and
// typechecks) before the native target exists.
type SharedDefaultsModule = {
  setItem: (suite: string, key: string, value: string) => unknown;
  removeItem: (suite: string, key: string) => unknown;
};

function isModule(x: unknown): x is SharedDefaultsModule {
  const m = x as Partial<SharedDefaultsModule> | undefined;
  return !!m && typeof m.setItem === 'function' && typeof m.removeItem === 'function';
}

// Resolve the native App Group bridge. Under the New Architecture (bridgeless),
// a legacy RCT_EXTERN_MODULE is NOT always present on `NativeModules` — it can
// only be reachable via TurboModuleRegistry. We were only checking
// NativeModules, so on a bridgeless build `sharedDefaults()` returned null and
// the mirror silently no-opped (the device-token row still gets minted over the
// network, so this looks "fine" server-side while the App Group stays empty and
// the Share Extension shows "Open the app and sign in"). Check both registries.
function sharedDefaults(): SharedDefaultsModule | null {
  const mods = NativeModules as Record<string, unknown>;
  const fromNativeModules = mods.SimSharedDefaults ?? mods.SharedAppGroupDefaults;
  if (isModule(fromNativeModules)) return fromNativeModules;

  // Bridgeless / New Architecture fallback.
  for (const name of ['SimSharedDefaults', 'SharedAppGroupDefaults']) {
    try {
      const fromTurbo = TurboModuleRegistry.get(name);
      if (isModule(fromTurbo)) return fromTurbo as SharedDefaultsModule;
    } catch {
      /* not registered as a turbo module — keep looking */
    }
  }
  return null;
}

async function mirrorToAppGroup(token: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const mod = sharedDefaults();
  if (!mod) {
    // Stay silent in dev: config-plugin native code (SimSharedDefaults) isn't in
    // the Expo Go / Metro dev bundle, so its absence here is expected and
    // harmless — logging it just spams the dev console (and any console.error
    // trips the redbox). In a SHIPPED build (__DEV__ === false) this absence IS
    // the share-extension regression — the mirror can't write, so the App Group
    // stays empty and the extension shows "Open the app and sign in" even though
    // token minting (a network RPC) succeeds. Surface it there only, as a warn
    // (not a redbox error), once, with the available modules for diagnosis.
    if (!__DEV__ && !warnedMirrorModuleMissing) {
      warnedMirrorModuleMissing = true;
      console.warn(
        '[share-token] MIRROR SKIPPED — SimSharedDefaults native module not found. ' +
          'App Group will be empty; Share Extension cannot read the session. ' +
          'Available NativeModules: ' + Object.keys(NativeModules).join(', ')
      );
    }
    postAppBeacon({
      module_present: false,
      write_returned: false,
      note: 'native module missing',
    });
    return;
  }
  try {
    await mod.setItem(SHARE_APP_GROUP, APP_GROUP_KEY, token);
    console.log('[share-token] mirrored device token to App Group', SHARE_APP_GROUP);
    postAppBeacon({ module_present: true, write_returned: true });
  } catch (e) {
    console.error('[share-token] App Group write failed', e);
    postAppBeacon({
      module_present: true,
      write_returned: false,
      note: e instanceof Error ? e.message : String(e),
    });
  }
}

async function clearFromAppGroup(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const mod = sharedDefaults();
  if (!mod) return;
  try {
    await mod.removeItem(SHARE_APP_GROUP, APP_GROUP_KEY);
  } catch (e) {
    console.warn('[share-token] App Group clear failed', e);
  }
}

/**
 * Ensure a device token exists for the signed-in creator and is mirrored to the
 * App Group. Mints only when none is stored (reused across sessions). Safe to
 * call on every creator sign-in / app open — idempotent and fire-and-forget.
 * Returns the token, or null if minting failed (e.g. not signed in).
 */
export async function ensureShareDeviceToken(): Promise<string | null> {
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY);
    if (existing) {
      // Keep the App Group copy in sync (e.g. first run after the native shim
      // ships, or if the extension's value was cleared by the OS).
      await mirrorToAppGroup(existing);
      return existing;
    }
    const { data, error } = await supabase.rpc('issue_share_device_token', {
      p_label: 'ios-share',
    });
    const token = typeof data === 'string' ? data : null;
    if (error || !token) {
      if (error) console.warn('[share-token] issue failed:', error.message);
      return null;
    }
    await AsyncStorage.setItem(STORAGE_KEY, token);
    await mirrorToAppGroup(token);
    return token;
  } catch (e) {
    console.warn('[share-token] ensure failed', e);
    return null;
  }
}

/**
 * Revoke the stored device token server-side and clear it locally + from the App
 * Group. Call on explicit logout (a session is still active for the RPC).
 */
export async function revokeShareDeviceToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(STORAGE_KEY);
    if (token) {
      try {
        await supabase.rpc('revoke_share_device_token', { p_token: token });
      } catch (e) {
        console.warn('[share-token] revoke rpc failed', e);
      }
    }
  } finally {
    await clearLocalAndAppGroup();
  }
}

/**
 * Clear the device token from local storage AND the App Group WITHOUT calling
 * the revoke RPC. Used on involuntary sign-out (stale refresh token — no session
 * to authorize a revoke) so the extension can no longer read a usable token.
 */
export async function clearLocalAndAppGroup(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  await clearFromAppGroup();
}
