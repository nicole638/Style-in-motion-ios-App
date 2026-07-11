// Share Extension — "Share → Styled in Motion" (rich in-sheet editor).
//
// Replaces the old spinner-only hand-off with a Snapshop-style flow that runs
// entirely inside the iOS share sheet:
//   1. Read the creator's device token from the shared App Group + the shared URL.
//   2. POST {token,url} to `share-preview` → product (name/brand/price/image
//      gallery) + the brand's commission (real range, or nil = "not
//      commissionable yet") + the creator's collections (Looks).
//   3. Creator picks an image, writes a note, optionally picks/creates a
//      collection.
//   4. "Create Link" → `share-create-link` → a copyable commissionable link.
//
// The two function URLs are derived from SIM_SUPABASE_URL (injected into this
// target's Info.plist by plugins/withShareExtension.js). The anon key is public;
// the device token is the real auth. UI is SwiftUI hosted in the principal
// UIViewController so Info.plist's NSExtensionPrincipalClass is unchanged.
import UIKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Config (read from this target's Info.plist)

struct ExtensionConfig {
  let appGroup: String
  let tokenKey: String
  let supabaseURL: String
  let anonKey: String

  static func fromBundle() -> ExtensionConfig {
    func v(_ k: String) -> String { (Bundle.main.object(forInfoDictionaryKey: k) as? String) ?? "" }
    return ExtensionConfig(
      appGroup: v("SIM_APP_GROUP"),
      tokenKey: v("SIM_SHARE_TOKEN_KEY"),
      supabaseURL: v("SIM_SUPABASE_URL").hasSuffix("/") ? String(v("SIM_SUPABASE_URL").dropLast()) : v("SIM_SUPABASE_URL"),
      anonKey: v("SIM_ANON_KEY")
    )
  }

  var previewURL: URL? { URL(string: "\(supabaseURL)/functions/v1/share-preview") }
  var createURL: URL? { URL(string: "\(supabaseURL)/functions/v1/share-create-link") }

  func readToken() -> String? {
    UserDefaults(suiteName: appGroup)?.string(forKey: tokenKey)
  }
}

// MARK: - Brand

enum Brand {
  static let coral = Color(red: 0.722, green: 0.439, blue: 0.388)   // #B87063
  static let ink = Color(red: 0.102, green: 0.071, blue: 0.063)     // #1A1210
  static let muted = Color(red: 0.42, green: 0.37, blue: 0.345)     // #6B5E58
  static let cardBg = Color(red: 0.98, green: 0.965, blue: 0.957)   // #FBF6F4
  static let chipBg = Color(red: 0.93, green: 0.91, blue: 0.90)
  static let green = Color(red: 0.36, green: 0.55, blue: 0.30)
}

// MARK: - Principal view controller

class ShareViewController: UIViewController {
  private let config = ExtensionConfig.fromBundle()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.25)
    extractURL { [weak self] url in
      guard let self = self else { return }
      let token = self.config.readToken()
      let root = ShareRootView(
        config: self.config,
        sharedURL: url,
        token: token,
        onClose: { [weak self] in self?.close() }
      )
      let host = UIHostingController(rootView: root)
      host.view.backgroundColor = .clear
      self.addChild(host)
      host.view.frame = self.view.bounds
      host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      self.view.addSubview(host.view)
      host.didMove(toParent: self)
    }
  }

  private func close() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }

  // Pull a URL from the share payload: prefer a public.url attachment (Safari),
  // fall back to text containing an https link (Instagram, etc.).
  private func extractURL(_ completion: @escaping (String?) -> Void) {
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    let urlType = UTType.url.identifier
    if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
      p.loadItem(forTypeIdentifier: urlType, options: nil) { item, _ in
        var resolved: String?
        if let u = item as? URL { resolved = u.absoluteString }
        else if let s = item as? String { resolved = s }
        DispatchQueue.main.async { completion(resolved) }
      }
      return
    }
    let textType = UTType.plainText.identifier
    if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(textType) }) {
      p.loadItem(forTypeIdentifier: textType, options: nil) { item, _ in
        let text = (item as? String) ?? ""
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        let match = detector?.firstMatch(in: text, options: [], range: range)
        DispatchQueue.main.async { completion(match?.url?.absoluteString) }
      }
      return
    }
    completion(nil)
  }
}

// MARK: - API models

private struct PreviewResponse: Decodable { let data: PreviewData?; let error: APIError? }
private struct PreviewData: Decodable {
  let product: Product
  let commission: Commission?
  let collections: [CollectionItem]
}
private struct Product: Decodable {
  let name: String?; let brand: String?; let price: String?
  let images: [String]; let primaryImage: String?; let siteName: String?
}
private struct Commission: Decodable {
  let merchantName: String?; let minPct: Double?; let maxPct: Double?
  let network: String?; let logoUrl: String?
}
private struct CollectionItem: Decodable, Identifiable {
  let id: String; let title: String; let coverUrl: String?
}
private struct APIError: Decodable { let message: String; let code: String }
private struct CreateResponse: Decodable { let data: CreateData?; let error: APIError? }
private struct CreateData: Decodable { let itemId: String; let shareUrl: String; let lookId: String? }

// MARK: - Root SwiftUI view

private enum Phase: Equatable {
  case loading
  case needsSignIn
  case editing
  case creating
  case done(String)     // share link
  case failed(String)   // message
}

struct ShareRootView: View {
  let config: ExtensionConfig
  let sharedURL: String?
  let token: String?
  let onClose: () -> Void

  @State private var phase: Phase = .loading
  @State private var product: Product?
  @State private var commission: Commission?
  @State private var collections: [CollectionItem] = []

  @State private var selectedImage: String?
  @State private var note: String = ""
  @State private var selectedCollectionId: String?    // nil = none / new
  @State private var newCollectionName: String = ""
  @State private var didCopy = false

  init(config: ExtensionConfig, sharedURL: String?, token: String?, onClose: @escaping () -> Void) {
    self.config = config
    self.sharedURL = sharedURL
    self.token = token
    self.onClose = onClose
  }

  var body: some View {
    ZStack(alignment: .bottom) {
      Color.clear.contentShape(Rectangle()).onTapGesture { if canDismissByTap { onClose() } }
      card
        .background(Brand.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
        .shadow(color: Color.black.opacity(0.18), radius: 16, y: -2)
    }
    .ignoresSafeArea(.container, edges: .bottom)
    .onAppear(perform: start)
  }

  private var canDismissByTap: Bool {
    switch phase { case .loading, .editing, .needsSignIn, .failed: return true; default: return false }
  }

  // MARK: phases

  @ViewBuilder private var card: some View {
    switch phase {
    case .loading:      loadingCard
    case .needsSignIn:  messageCard(title: "Sign in first",
                                    body: "Open Styled in Motion and sign in, then share again.",
                                    icon: "person.crop.circle")
    case .failed(let m): messageCard(title: "Couldn't load", body: m, icon: "exclamationmark.triangle")
    case .editing, .creating: editor
    case .done(let link): successCard(link: link)
    }
  }

  private var loadingCard: some View {
    VStack(spacing: 14) {
      grabber
      ProgressView().tint(Brand.coral).scaleEffect(1.1)
      Text("Gathering product…").font(.system(size: 15, weight: .semibold)).foregroundColor(Brand.ink)
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 12).padding(.bottom, 40)
  }

  private func messageCard(title: String, body: String, icon: String) -> some View {
    VStack(spacing: 12) {
      grabber
      Image(systemName: icon).font(.system(size: 30)).foregroundColor(Brand.coral)
      Text(title).font(.system(size: 18, weight: .bold)).foregroundColor(Brand.ink)
      Text(body).font(.system(size: 14)).foregroundColor(Brand.muted)
        .multilineTextAlignment(.center).padding(.horizontal, 24)
      Button(action: onClose) { pillLabel("Done", filled: true) }.padding(.top, 4)
    }
    .frame(maxWidth: .infinity).padding(.top, 12).padding(.bottom, 36).padding(.horizontal, 16)
  }

  // MARK: editor

  private var editor: some View {
    VStack(spacing: 0) {
      grabber.padding(.top, 10)
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          headerRow
          commissionRow
          imagePicker
          noteField
          collectionPicker
          Color.clear.frame(height: 8)
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
      }
      createBar
    }
    .padding(.bottom, 8)
  }

  private var headerRow: some View {
    HStack(alignment: .top, spacing: 12) {
      productThumb(selectedImage ?? product?.primaryImage, size: 76)
      VStack(alignment: .leading, spacing: 3) {
        Text(product?.name ?? "New item")
          .font(.system(size: 16, weight: .semibold)).foregroundColor(Brand.ink)
          .lineLimit(2)
        if let site = product?.brand ?? product?.siteName {
          Text(site).font(.system(size: 13)).foregroundColor(Brand.muted)
        }
        if let price = product?.price, !price.isEmpty {
          Text(price).font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.ink).padding(.top, 1)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.top, 6)
  }

  private var commissionRow: some View {
    HStack(spacing: 8) {
      if let c = commission, let label = commissionLabel(c) {
        Image(systemName: "tag.fill").font(.system(size: 12)).foregroundColor(Brand.green)
        Text(label).font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.ink)
        if let m = c.merchantName { Text("· \(m)").font(.system(size: 13)).foregroundColor(Brand.muted).lineLimit(1) }
      } else {
        Image(systemName: "tag").font(.system(size: 12)).foregroundColor(Brand.muted)
        Text("Not commissionable yet").font(.system(size: 14, weight: .medium)).foregroundColor(Brand.muted)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 10).padding(.horizontal, 12)
    .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
  }

  private var imagePicker: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Select image").font(.system(size: 13, weight: .semibold)).foregroundColor(Brand.muted)
      let imgs = product?.images ?? []
      if imgs.isEmpty {
        Text("No images found — your link still works.").font(.system(size: 13)).foregroundColor(Brand.muted)
      } else {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 10) {
            ForEach(imgs, id: \.self) { url in
              Button { selectedImage = url } label: {
                productThumb(url, size: 92)
                  .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                      .stroke(selectedImage == url ? Brand.coral : Color.clear, lineWidth: 3)
                  )
              }.buttonStyle(.plain)
            }
          }
        }
      }
    }
  }

  private var noteField: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Add a note").font(.system(size: 13, weight: .semibold)).foregroundColor(Brand.muted)
      // Single-line TextField keeps this iOS 15.1-compatible (TextField(axis:)
      // is iOS 16+). A short description is all this field needs.
      TextField("Write a description…", text: $note)
        .font(.system(size: 15)).foregroundColor(Brand.ink)
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
  }

  private var collectionPicker: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Add to collection").font(.system(size: 13, weight: .semibold)).foregroundColor(Brand.muted)
      Menu {
        Button("None") { selectedCollectionId = nil; newCollectionName = "" }
        if !collections.isEmpty { Divider() }
        ForEach(collections) { c in
          Button(c.title) { selectedCollectionId = c.id; newCollectionName = "" }
        }
        Divider()
        Button("＋ New collection…") { selectedCollectionId = "__new__"; }
      } label: {
        HStack {
          Text(collectionLabel).font(.system(size: 15, weight: .medium)).foregroundColor(Brand.ink)
          Spacer()
          Image(systemName: "chevron.up.chevron.down").font(.system(size: 12)).foregroundColor(Brand.muted)
        }
        .padding(12).background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
      if selectedCollectionId == "__new__" {
        TextField("New collection name", text: $newCollectionName)
          .font(.system(size: 15)).foregroundColor(Brand.ink)
          .padding(12).background(Color.white)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
    }
  }

  private var createBar: some View {
    VStack(spacing: 0) {
      Divider().opacity(0.4)
      Button(action: createLink) {
        HStack(spacing: 8) {
          if case .creating = phase { ProgressView().tint(.white) }
          Text(phaseIsCreating ? "Creating link…" : "Create Quick Link")
            .font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 15)
        .background(Brand.coral).clipShape(Capsule())
      }
      .disabled(phaseIsCreating)
      .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 6)
    }
    .background(Brand.cardBg)
  }

  private func successCard(link: String) -> some View {
    VStack(spacing: 14) {
      grabber
      Image(systemName: "checkmark.seal.fill").font(.system(size: 34)).foregroundColor(Brand.green)
      Text("Link created!").font(.system(size: 19, weight: .bold)).foregroundColor(Brand.ink)
      if commission != nil {
        Text("Commissionable link ready to share.").font(.system(size: 14)).foregroundColor(Brand.muted)
      } else {
        Text("Ready to share. This brand isn't commissionable yet.").font(.system(size: 14))
          .foregroundColor(Brand.muted).multilineTextAlignment(.center).padding(.horizontal, 20)
      }
      HStack(spacing: 8) {
        Text(link).font(.system(size: 13)).foregroundColor(Brand.ink).lineLimit(1).truncationMode(.middle)
        Spacer(minLength: 8)
        Button {
          UIPasteboard.general.string = link
          didCopy = true
        } label: {
          Text(didCopy ? "Copied" : "Copy").font(.system(size: 14, weight: .semibold))
            .foregroundColor(.white).padding(.horizontal, 16).padding(.vertical, 8)
            .background(Brand.ink).clipShape(Capsule())
        }
      }
      .padding(12).background(Color.white)
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      .padding(.horizontal, 16)
      Button(action: onClose) { pillLabel("Done", filled: true) }.padding(.top, 2)
    }
    .frame(maxWidth: .infinity).padding(.top, 12).padding(.bottom, 36)
  }

  // MARK: small components

  private var grabber: some View {
    Capsule().fill(Color.black.opacity(0.15)).frame(width: 38, height: 5).padding(.bottom, 2)
  }

  private func pillLabel(_ text: String, filled: Bool) -> some View {
    Text(text).font(.system(size: 16, weight: .semibold))
      .foregroundColor(filled ? .white : Brand.ink)
      .padding(.vertical, 13).padding(.horizontal, 40)
      .background(filled ? Brand.coral : Color.white)
      .clipShape(Capsule())
  }

  private func productThumb(_ url: String?, size: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: 12, style: .continuous)
      .fill(Brand.chipBg)
      .frame(width: size, height: size)
      .overlay(
        Group {
          if let s = url, let u = URL(string: s) {
            AsyncImage(url: u) { img in img.resizable().scaledToFill() } placeholder: { ProgressView().tint(Brand.coral) }
          }
        }
      )
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
  }

  private var phaseIsCreating: Bool { if case .creating = phase { return true }; return false }

  private var collectionLabel: String {
    if selectedCollectionId == "__new__" { return "New collection" }
    if let id = selectedCollectionId, let c = collections.first(where: { $0.id == id }) { return c.title }
    return "None"
  }

  private func commissionLabel(_ c: Commission) -> String? {
    let mn = c.minPct, mx = c.maxPct
    func fmt(_ d: Double) -> String { d == d.rounded() ? String(Int(d)) : String(format: "%.1f", d) }
    if let mx = mx, let mn = mn, mx > mn { return "Up to \(fmt(mx))% commission" }
    if let mx = mx { return "\(fmt(mx))% commission" }
    if let mn = mn { return "\(fmt(mn))% commission" }
    return nil
  }

  // MARK: networking

  private func start() {
    guard let token = token, !token.isEmpty else { phase = .needsSignIn; return }
    guard let url = sharedURL, url.hasPrefix("http") else { phase = .failed("Couldn't read the shared link."); return }
    guard let endpoint = config.previewURL else { phase = .failed("Not configured."); return }
    Task { await loadPreview(endpoint: endpoint, token: token, url: url) }
  }

  private func loadPreview(endpoint: URL, token: String, url: String) async {
    var req = URLRequest(url: endpoint)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(config.anonKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(config.anonKey)", forHTTPHeaderField: "Authorization")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "url": url])
    req.timeoutInterval = 30
    do {
      let (data, _) = try await URLSession.shared.data(for: req)
      let decoded = try JSONDecoder().decode(PreviewResponse.self, from: data)
      if let d = decoded.data {
        await MainActor.run {
          self.product = d.product
          self.commission = d.commission
          self.collections = d.collections
          self.selectedImage = d.product.primaryImage ?? d.product.images.first
          self.phase = .editing
        }
      } else {
        await MainActor.run { self.phase = .failed(decoded.error?.message ?? "Couldn't read this product.") }
      }
    } catch {
      await MainActor.run { self.phase = .failed("Network hiccup — try sharing again.") }
    }
  }

  private func createLink() {
    guard let token = token, let url = sharedURL, let endpoint = config.createURL else { return }
    phase = .creating
    Task { await postCreate(endpoint: endpoint, token: token, url: url) }
  }

  private func postCreate(endpoint: URL, token: String, url: String) async {
    var payload: [String: Any] = [
      "token": token, "url": url,
      "name": product?.name ?? "",
      "brand": product?.brand ?? "",
      "price": product?.price ?? "",
      "image_url": selectedImage ?? product?.primaryImage ?? "",
      "note": note,
    ]
    if selectedCollectionId == "__new__" {
      let t = newCollectionName.trimmingCharacters(in: .whitespacesAndNewlines)
      if !t.isEmpty { payload["new_look_title"] = t }
    } else if let id = selectedCollectionId {
      payload["look_id"] = id
    }
    var req = URLRequest(url: endpoint)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(config.anonKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(config.anonKey)", forHTTPHeaderField: "Authorization")
    req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
    req.timeoutInterval = 30
    do {
      let (data, _) = try await URLSession.shared.data(for: req)
      let decoded = try JSONDecoder().decode(CreateResponse.self, from: data)
      if let d = decoded.data {
        await MainActor.run { self.phase = .done(d.shareUrl) }
      } else {
        await MainActor.run { self.phase = .failed(decoded.error?.message ?? "Couldn't create the link.") }
      }
    } catch {
      await MainActor.run { self.phase = .failed("Network hiccup — try again.") }
    }
  }
}
