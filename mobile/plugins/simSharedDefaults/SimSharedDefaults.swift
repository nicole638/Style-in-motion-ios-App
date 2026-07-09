// SimSharedDefaults — tiny native module the JS calls to mirror the share
// device token into the App Group so the Share Extension can read it while the
// app is closed. Interface matches docs/share-extension-setup.md exactly.
//
// Copied into ios/<app>/ at prebuild by plugins/withSimSharedDefaults.js.
// The JS seam lives in mobile/src/lib/share/deviceToken.ts (NativeModules.SimSharedDefaults).
import Foundation

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
