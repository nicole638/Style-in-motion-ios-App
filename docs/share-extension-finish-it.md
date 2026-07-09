# Share Extension — "Finish it" checklist (Portal + build)

The native **config-as-code is now in the repo** (Option A). Everything below the
"Done in-repo" line is authored and was **validated by running `expo prebuild`**
(the plugins run clean and produce a correctly wired Xcode project). What remains
is the part this repo/dev-loop **cannot** do: Apple Developer Portal setup, a real
native build, and on-device verification. Those need a dev with **Nicole's Apple
account**.

> Reminder: the `[share-token] App Group native module not present yet` warning
> in the Expo preview is **expected** and not a bug. The preview runs JS in the
> existing Vibecode host binary; the native module + extension only exist once a
> fresh native binary is built (step 2 below).

---

## Done in-repo (no further authoring needed)

1. **App Group `group.studio.styledinmotion`**
   - Main app: `mobile/app.json` → `ios.entitlements` → `com.apple.security.application-groups`.
   - Extension: `mobile/plugins/shareExtension/ShareExtension.entitlements`.
   - Matches `SHARE_APP_GROUP` in `mobile/src/lib/share/deviceToken.ts`.
2. **`SimSharedDefaults` native module** — `mobile/plugins/withSimSharedDefaults.js`
   copies `plugins/simSharedDefaults/SimSharedDefaults.{swift,m}` into the app
   target and registers them in the Xcode Sources phase. Interface is exactly the
   one the JS calls (`setItem` / `removeItem` → `UserDefaults(suiteName:)`).
3. **Share Extension target** — `mobile/plugins/withShareExtension.js` creates the
   `ShareExtension` app-extension target (`…-c77kcu.share`), embeds the `.appex`
   into PlugIns, wires the dependency, and injects config (App Group, token key,
   function URL, anon key) into the extension's `Info.plist`. The extension
   (`plugins/shareExtension/ShareViewController.swift`) reads the token from the
   App Group + the shared URL and POSTs to the live `share-add-item` function.

Prebuild validation confirmed: target present, `productType = app-extension`,
`ShareExtension.appex in Copy Files` with `dstSubfolderSpec = 13` (PlugIns),
target dependency created, both entitlements carry the App Group, Info.plist fully
substituted (no leftover placeholders), and the module files land in the app's
Sources phase. Swift *compilation* itself is the only thing not exercised here
(needs macOS/Xcode) — that happens in step 2.

---

## To finish (outside this repo — needs Nicole's Apple account)

### 1. Apple Developer Portal
- **Register the App Group** `group.studio.styledinmotion` (Identifiers → App Groups).
- **Create the extension's App ID / bundle ID** `com.vibecode.styled.in.motion-c77kcu.share`
  and enable the **App Groups** capability on it (select the group above).
- **Enable App Groups** on the main app ID `com.vibecode.styled.in.motion-c77kcu`
  as well (select the same group).
- **Regenerate provisioning profiles** for **both** targets so each carries the
  App Group entitlement. (EAS-managed credentials can do this automatically on the
  next build if it has Portal access; otherwise create them manually.)

### 2. Fresh EAS native build
- Run `eas build -p ios` (this runs `expo prebuild` → compiles the module +
  extension into a new binary). Install that binary (TestFlight or dev build).
- If EAS needs the signing team, set `DEVELOPMENT_TEAM` — either pass
  `developmentTeam` in the `withShareExtension` plugin props in `app.json`, or let
  EAS-managed credentials handle signing.
- Deployment target defaults to **iOS 15.1** (`deploymentTarget` prop); bump it in
  `app.json` if the app's minimum differs.

### 3. On-device verify (acceptance)
- **Signed-in creator:** Safari (or Instagram) on a product page → Share →
  **Styled in Motion** → "Saved to Styled in Motion ✓" → item appears in the
  closet (pending, then fills in — same as the in-app browser add).
- **Logged out / revoked token:** friendly "Open the app and sign in" message,
  nothing inserted.
- **Affiliate match** → item comes back monetized; **non-match** → existing
  earn-elsewhere suggester fires.

---

## Config knobs (in `app.json` → `withShareExtension` plugin props)

| Prop | Current value | Notes |
|---|---|---|
| `appGroup` | `group.studio.styledinmotion` | keep in sync with `deviceToken.ts` + entitlements |
| `bundleIdentifier` | `com.vibecode.styled.in.motion-c77kcu.share` | must be registered in the Portal |
| `supabaseUrl` + `functionPath` | `…supabase.co` + `/functions/v1/share-add-item` | the live edge function |
| `supabaseAnonKey` | (public anon key) | safe to embed; the device token is the real auth |
| `tokenKey` | `sim_share_token` | App Group key the JS writes / extension reads |
| `deploymentTarget` | `15.1` | match the app's minimum iOS |
| `developmentTeam` | _(unset)_ | optional; EAS credentials can supply signing |

## Alternative for the target wiring
`withShareExtension.js` hand-wires the Xcode target via the `xcode` lib (already a
dependency, so the repo stays install-free and the preview stays green). If the
pbxproj wiring ever needs to change, it can be swapped for the maintained
[`@bacons/apple-targets`](https://github.com/EvanBacon/apple-targets) plugin
without touching the Swift or the JS seam.
