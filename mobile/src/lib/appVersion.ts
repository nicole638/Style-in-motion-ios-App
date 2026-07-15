import Constants from 'expo-constants';
import * as Application from 'expo-application';

/**
 * The version string shown as "App Version" in profile/account screens.
 *
 * Reads the ACTUALLY-INSTALLED native binary — `nativeApplicationVersion` is the
 * app.json `version` baked into the build (e.g. "5.7") and `nativeBuildVersion`
 * is the iOS build number (e.g. "36"). Because it comes from the installed
 * bundle, it updates automatically on every build with zero manual steps.
 *
 * This deliberately does NOT use `app_metadata.current_version` (a server table)
 * for display — that value is for "update available" / min-supported checks and
 * has to be hand-maintained, so it drifts out of sync with what the user is
 * actually running. `expo-constants` is only a web/dev fallback where the native
 * module returns null.
 *
 * Format: "5.7 (36)" — version plus build, so a TestFlight tester can report
 * exactly which build they're on.
 */
export function getDisplayAppVersion(): string {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
  const build = Application.nativeBuildVersion ?? null;
  if (!version) return '—';
  return build ? `${version} (${build})` : version;
}
