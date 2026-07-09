# Share → Styled in Motion — native setup contract

The **JS/app side is done** (this repo). It mints a long-lived device token for the
signed-in creator and mirrors it into a shared App Group so the share extension can
read it. The pieces below are the **native/EAS work** the app harness owns. Wire them
to the contract the JS already expects and the feature lights up — no further JS changes.

## 1. App Group (shared by app + extension)
- Entitlement on **both** the main app target **and** the share-extension target:
  `group.studio.styledinmotion`
- This string is `SHARE_APP_GROUP` in `mobile/src/lib/share/deviceToken.ts`. If you use a
  different group id, update that constant to match (one line).

## 2. Native module the JS calls: `SimSharedDefaults`
`deviceToken.ts` writes the token via a native module resolved from
`NativeModules.SimSharedDefaults` (falls back to `SharedAppGroupDefaults`). Implement this
exact interface (writes to `UserDefaults(suiteName:)`):

```swift
@objc(SimSharedDefaults)
class SimSharedDefaults: NSObject {
  @objc func setItem(_ suite: String, key: String, value: String) {
    UserDefaults(suiteName: suite)?.set(value, forKey: key)
  }
  @objc func removeItem(_ suite: String, key: String) {
    UserDefaults(suiteName: suite)?.removeObject(forKey: key)
  }
  @objc static func requiresMainQueueSetup() -> Bool { false }
}
```
Until this module exists the JS no-ops gracefully (token still minted + stored locally;
it just isn't mirrored cross-process). The stored key is `sim_share_token`.

## 3. The share extension
Read the token from the App Group, the URL from the share payload, POST to the
**deployed** `share-add-item` edge function (backend is done):

```swift
let token = UserDefaults(suiteName: "group.studio.styledinmotion")?.string(forKey: "sim_share_token")
var req = URLRequest(url: URL(string: "https://rghlcnrttvlvphzahudf.supabase.co/functions/v1/share-add-item")!)
req.httpMethod = "POST"
req.setValue("application/json", forHTTPHeaderField: "Content-Type")
req.setValue(ANON_KEY, forHTTPHeaderField: "apikey")   // anon key is public; the device token is the auth
req.httpBody = try JSONSerialization.data(withJSONObject: ["url": sharedURL, "token": token ?? ""])
// → { ok: true, item_id } : show "Saved to Styled in Motion ✓" and dismiss
// → { ok: false, error }   : show "Couldn't save — open the app and try again"
```

## How the JS lifecycle behaves (already wired in `authStore.ts`)
- **Creator sign-in / session restore / refresh** (`onAuthStateChange`) → `ensureShareDeviceToken()`:
  mints via `issue_share_device_token` **only if none stored**, caches in AsyncStorage,
  mirrors to the App Group. Reused across sessions (no wasteful rotation).
- **Logout** → `revokeShareDeviceToken()` (RPC `revoke_share_device_token`) + clears local + App Group.
- **Involuntary sign-out / delete account** → clears local + App Group (no usable token left for the extension).

## Acceptance (once native lands)
- Logged-in creator: Safari product page → Share → Styled in Motion → "Saved ✓" → item appears in closet (pending → fills in).
- Logged-out / revoked → friendly "open the app" message, nothing inserted.
- Affiliate match → monetized; non-match → existing earn-elsewhere suggester.
