// Share Extension — "Share → Styled in Motion".
//
// Reads the creator's long-lived device token from the shared App Group
// (written by the SimSharedDefaults native module while the app is signed in),
// grabs the shared URL, and POSTs to the live share-add-item edge function.
//
//   POST {SUPABASE_FUNCTION_URL}
//   headers: apikey: {SUPABASE_ANON_KEY}, content-type: application/json
//   body:    { "url": <shared url>, "token": <app-group token> }
//   → { "ok": true, "item_id": "..." }  → "Saved to Styled in Motion ✓"
//   → { "ok": false, ... } / no token   → "Open the app and sign in"
//
// Config (App Group id, anon key, function URL, token key) is injected into this
// target's Info.plist at prebuild by plugins/withShareExtension.js, so no
// secrets are hardcoded here. The anon key is public; the device token is the
// real auth.
import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
  // MARK: - UI
  private let card = UIView()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let label = UILabel()

  // MARK: - Config (from this extension's Info.plist)
  private func configValue(_ key: String) -> String {
    return (Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? ""
  }
  private var appGroup: String { configValue("SIM_APP_GROUP") }
  private var tokenKey: String { configValue("SIM_SHARE_TOKEN_KEY") }
  private var supabaseURL: String { configValue("SIM_SUPABASE_URL") }
  private var functionURL: String { configValue("SIM_FUNCTION_URL") }
  private var anonKey: String { configValue("SIM_ANON_KEY") }

  override func viewDidLoad() {
    super.viewDidLoad()
    setupUI()
    handleShare()
  }

  // MARK: - Flow
  private func handleShare() {
    let token = readToken()
    // READ-side runtime beacon — the whole point of build 5.x debugging: prove
    // from the server whether THIS extension can actually see the App Group the
    // app wrote to. `containerReachable` = did the entitlement/provisioning
    // actually grant us the group at runtime; `tokenFound` = was sim_share_token
    // present. Fire-and-forget; never blocks the share UI.
    sendReadBeacon(tokenFound: !((token ?? "").isEmpty))
    guard let token = token, !token.isEmpty else {
      finish(success: false, message: "Open the app and sign in")
      return
    }
    extractURL { [weak self] url in
      guard let self = self else { return }
      guard let url = url, !url.isEmpty else {
        self.finish(success: false, message: "Couldn't read the link — try again")
        return
      }
      self.postItem(url: url, token: token)
    }
  }

  private func readToken() -> String? {
    return UserDefaults(suiteName: appGroup)?.string(forKey: tokenKey)
  }

  // POST a one-row diagnostic beacon to public.share_beacon via PostgREST using
  // the anon key this target already carries. Lets us see server-side (Nicole
  // can't read device logs) whether the extension resolved the App Group
  // container and found the mirrored token. Fire-and-forget, best-effort.
  private func sendReadBeacon(tokenFound: Bool) {
    let base = supabaseURL
    guard !base.isEmpty, !anonKey.isEmpty,
          let url = URL(string: base + "/rest/v1/share_beacon") else { return }

    // If the App Group entitlement/provisioning didn't actually land on this
    // target, the OS returns nil for the shared container — the definitive
    // reader-side signal.
    let containerReachable = FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil
    let appVersion = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? ""
    let buildNumber = (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? ""
    // Single `build` column on public.share_beacon: "5.2 (30)".
    let build = "\(appVersion) (\(buildNumber))"

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(anonKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
    req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
    let body: [String: Any] = [
      "side": "extension_read",
      "app_group": appGroup,
      "container_reachable": containerReachable,
      "token_found": tokenFound,
      "build": build,
    ]
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: req).resume()
  }

  // Pull a URL out of the share payload: prefer a real public.url attachment
  // (Safari), fall back to text that contains an https link (Instagram, etc.).
  private func extractURL(_ completion: @escaping (String?) -> Void) {
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let providers = items.flatMap { $0.attachments ?? [] }

    let urlType = UTType.url.identifier
    if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
      p.loadItem(forTypeIdentifier: urlType, options: nil) { (item, _) in
        var resolved: String?
        if let u = item as? URL { resolved = u.absoluteString }
        else if let s = item as? String { resolved = s }
        DispatchQueue.main.async { completion(resolved) }
      }
      return
    }

    let textType = UTType.plainText.identifier
    if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(textType) }) {
      p.loadItem(forTypeIdentifier: textType, options: nil) { [weak self] (item, _) in
        let text = (item as? String) ?? ""
        let resolved = self?.firstURL(in: text)
        DispatchQueue.main.async { completion(resolved) }
      }
      return
    }

    completion(nil)
  }

  private func firstURL(in text: String) -> String? {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
      return nil
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    let match = detector.firstMatch(in: text, options: [], range: range)
    return match?.url?.absoluteString
  }

  private func postItem(url: String, token: String) {
    guard let endpoint = URL(string: functionURL) else {
      finish(success: false, message: "Couldn't save — open the app and try again")
      return
    }
    var req = URLRequest(url: endpoint)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(anonKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
    let body: [String: Any] = ["url": url, "token": token]
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)

    URLSession.shared.dataTask(with: req) { [weak self] (data, _, error) in
      guard let self = self else { return }
      var ok = false
      if error == nil, let data = data,
         let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        ok = (json["ok"] as? Bool) ?? false
      }
      DispatchQueue.main.async {
        if ok {
          self.finish(success: true, message: "Saved to Styled in Motion ✓")
        } else {
          self.finish(success: false, message: "Couldn't save — open the app and try again")
        }
      }
    }.resume()
  }

  // MARK: - Completion
  private func finish(success: Bool, message: String) {
    spinner.stopAnimating()
    spinner.isHidden = true
    label.text = message
    // Give the user a beat to read the result, then dismiss the sheet.
    DispatchQueue.main.asyncAfter(deadline: .now() + (success ? 0.9 : 1.4)) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
  }

  // MARK: - UI setup
  private func setupUI() {
    view.backgroundColor = UIColor.black.withAlphaComponent(0.15)

    card.backgroundColor = UIColor.systemBackground
    card.layer.cornerRadius = 18
    card.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(card)

    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.startAnimating()
    card.addSubview(spinner)

    label.text = "Saving to Styled in Motion…"
    label.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
    label.textColor = UIColor.label
    label.numberOfLines = 0
    label.textAlignment = .center
    label.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(label)

    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 40),
      card.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -40),
      card.widthAnchor.constraint(greaterThanOrEqualToConstant: 240),

      spinner.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
      spinner.centerXAnchor.constraint(equalTo: card.centerXAnchor),

      label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 14),
      label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
      label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
      label.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -24),
    ])
  }
}
