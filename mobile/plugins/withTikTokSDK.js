// Expo config plugin for tiktok-opensdk-react-native.
//
// The npm package ships native iOS code + a podspec but NO Expo config
// plugin.  Autolinking picks up the pod, but two pieces of native config
// are still missing:
//
//   1. Info.plist — TikTokClientKey  (read at runtime by the native Swift
//      module to build the redirect URI).
//   2. AppDelegate — the URL-callback handler that resolves the share()
//      promise after TikTok redirects back to the app.
//
// This plugin injects both during `expo prebuild`.

const {
  withInfoPlist,
  withAppDelegate,
  withProjectBuildGradle,
  withAndroidManifest,
  AndroidConfig,
  createRunOncePlugin,
} = require('@expo/config-plugins');

const { addMetaDataItemToMainApplication, getMainApplicationOrThrow } =
  AndroidConfig.Manifest;

// The Android native module reads the client key from this AndroidManifest
// <meta-data> name (see TiktokOpensdkReactNativeModule.kt). Without it, share()
// throws "TikTok client key not found in AndroidManifest.xml" at runtime — the
// Android twin of the iOS Info.plist TikTokClientKey.
const ANDROID_CLIENT_KEY_METADATA = 'com.tiktokopensdkreactnative.tiktok.CLIENT_KEY';

const pkg = { name: 'tiktok-opensdk-react-native', version: '0.10.9' };

function withTikTokInfoPlist(config, { clientKey }) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.TikTokClientKey = clientKey;
    return cfg;
  });
}

function withTikTokAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    const contents = cfg.modResults.contents;
    const lang = cfg.modResults.language;

    if (lang === 'objcpp' || lang === 'objc') {
      cfg.modResults.contents = addObjcUrlHandler(contents);
    } else if (lang === 'swift') {
      cfg.modResults.contents = addSwiftUrlHandler(contents);
    }
    return cfg;
  });
}

// ────────────────────────────────────────────────────────────
// ObjC++ (AppDelegate.mm) — most common Expo prebuild output
// ────────────────────────────────────────────────────────────

const OBJC_IMPORT = '#import <TiktokOpensdkReactNative/TiktokOpensdkReactNative-Swift.h>';
const OBJC_HANDLER_SNIPPET = `  // TikTok Share SDK callback
  if ([TiktokOpensdkReactNative handleOpenURL:url]) {
    return YES;
  }`;

function addObjcUrlHandler(src) {
  if (src.includes('TiktokOpensdkReactNative')) return src;

  // 1. Add import after the last existing #import
  const importIndex = src.lastIndexOf('#import');
  if (importIndex !== -1) {
    const lineEnd = src.indexOf('\n', importIndex);
    src = src.slice(0, lineEnd + 1) + OBJC_IMPORT + '\n' + src.slice(lineEnd + 1);
  }

  // 2. Inject handler into application:openURL:options:
  //    Look for the method signature and inject right after the opening brace.
  const openUrlRegex = /(-\s*\(BOOL\)\s*application:.*openURL:.*options:.*\{)/;
  const match = src.match(openUrlRegex);
  if (match) {
    const insertPos = src.indexOf(match[0]) + match[0].length;
    src = src.slice(0, insertPos) + '\n' + OBJC_HANDLER_SNIPPET + '\n' + src.slice(insertPos);
  }

  return src;
}

// ────────────────────────────────────────────────────────────
// Swift (AppDelegate.swift) — used with some Expo configs
// ────────────────────────────────────────────────────────────

const SWIFT_IMPORT = 'import tiktok_opensdk_react_native';
const SWIFT_HANDLER_SNIPPET = `    // TikTok Share SDK callback
    if TiktokOpensdkReactNative.handleOpenURL(url) {
      return true
    }`;

function addSwiftUrlHandler(src) {
  if (src.includes('TiktokOpensdkReactNative')) return src;

  // 1. Add import after the last existing import
  const importIndex = src.lastIndexOf('import ');
  if (importIndex !== -1) {
    const lineEnd = src.indexOf('\n', importIndex);
    src = src.slice(0, lineEnd + 1) + SWIFT_IMPORT + '\n' + src.slice(lineEnd + 1);
  }

  // 2. Inject handler into application(_:open:options:)
  const openUrlRegex = /(func application\(.*open url:.*options:.*\) -> Bool \{)/;
  const match = src.match(openUrlRegex);
  if (match) {
    const insertPos = src.indexOf(match[0]) + match[0].length;
    src = src.slice(0, insertPos) + '\n' + SWIFT_HANDLER_SNIPPET + '\n' + src.slice(insertPos);
  }

  return src;
}

// ────────────────────────────────────────────────────────────
// Android — ByteDance Maven repository
//
// tiktok-opensdk-react-native depends on
//   com.tiktok.open.sdk:tiktok-open-sdk-core:2.3.0
//   com.tiktok.open.sdk:tiktok-open-sdk-share:2.3.0
// which are NOT on Maven Central or Google — only in ByteDance's own
// Maven repo. The library declares that repo in its own build.gradle
// `repositories {}` block, but that per-subproject declaration is not
// reliably honoured during autolinked resolution (build 4622ab5f failed
// with "Could not find com.tiktok.open.sdk:...:2.3.0"). Declaring it at
// the ROOT project's `allprojects.repositories` makes it available to
// every subproject and fixes resolution. Injected during prebuild so it
// survives regeneration of the android/ folder.
// ────────────────────────────────────────────────────────────

const BYTEDANCE_MAVEN_URL = 'https://artifact.bytedance.com/repository/AwemeOpenSDK';
const BYTEDANCE_MAVEN_LINE =
  `    maven { url '${BYTEDANCE_MAVEN_URL}' } // TikTok OpenSDK (ByteDance) — withTikTokSDK`;

function addByteDanceMavenRepo(src) {
  if (src.includes(BYTEDANCE_MAVEN_URL)) return src;

  // Insert the repo as the first entry inside `allprojects { repositories { ... } }`.
  const anchor = /(allprojects\s*\{[\s\S]*?repositories\s*\{)/;
  const match = src.match(anchor);
  if (match) {
    const insertPos = src.indexOf(match[0]) + match[0].length;
    return src.slice(0, insertPos) + '\n' + BYTEDANCE_MAVEN_LINE + src.slice(insertPos);
  }

  // Fallback: no allprojects block found — append one so the build still resolves.
  return (
    src +
    `\n\nallprojects {\n  repositories {\n${BYTEDANCE_MAVEN_LINE}\n  }\n}\n`
  );
}

function withTikTokAndroidRepo(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        `withTikTokSDK: cannot inject ByteDance Maven repo — unexpected build.gradle language "${cfg.modResults.language}"`,
      );
    }
    cfg.modResults.contents = addByteDanceMavenRepo(cfg.modResults.contents);
    return cfg;
  });
}

function withTikTokAndroidManifest(config, { clientKey }) {
  return withAndroidManifest(config, (cfg) => {
    const app = getMainApplicationOrThrow(cfg.modResults);
    // Idempotent — helper replaces the value if the meta-data already exists.
    addMetaDataItemToMainApplication(app, ANDROID_CLIENT_KEY_METADATA, clientKey);
    return cfg;
  });
}

// ────────────────────────────────────────────────────────────

function withTikTokSDK(config, props = {}) {
  const clientKey = props.clientKey;
  if (!clientKey) {
    throw new Error('withTikTokSDK: clientKey is required');
  }
  config = withTikTokInfoPlist(config, { clientKey });
  config = withTikTokAppDelegate(config);
  config = withTikTokAndroidRepo(config);
  config = withTikTokAndroidManifest(config, { clientKey });
  return config;
}

module.exports = createRunOncePlugin(withTikTokSDK, pkg.name, pkg.version);
