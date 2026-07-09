// Expo config plugin — adds the "Share → Styled in Motion" Share Extension
// target during `expo prebuild`.
//
// What it does (all at prebuild; nothing runs during `expo start`):
//   1. Copies ShareViewController.swift + a templated Info.plist +
//      ShareExtension.entitlements into ios/ShareExtension/, substituting the
//      App Group id, token key, function URL and anon key from plugin props.
//   2. Creates an `app_extension` PBXNativeTarget. The `xcode` lib's addTarget
//      auto-creates the "Embed App Extensions" copy-files phase in the app
//      target, embeds the .appex, and adds the target dependency — so we only
//      wire the group, source/resource/framework phases, and build settings.
//
// Alternative if the pbxproj wiring ever needs to change: swap this for
// @bacons/apple-targets (a maintained target plugin). This custom plugin keeps
// the repo dependency-free and matches the ./withTikTokSDK.js precedent.
const {
  withDangerousMod,
  withXcodeProject,
  createRunOncePlugin,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const pkg = { name: "sim-share-extension", version: "1.0.0" };

const TARGET_NAME = "ShareExtension";
const SWIFT_FILE = "ShareViewController.swift";
const INFO_PLIST = "Info.plist";
const ENTITLEMENTS = "ShareExtension.entitlements";

function templateDir(projectRoot) {
  return path.join(projectRoot, "plugins", "shareExtension");
}

function resolveProps(config, props) {
  const supabaseUrl = (props.supabaseUrl || "").replace(/\/+$/, "");
  const functionPath = props.functionPath || "/functions/v1/share-add-item";
  return {
    appGroup: props.appGroup || "group.studio.styledinmotion",
    tokenKey: props.tokenKey || "sim_share_token",
    supabaseUrl,
    functionUrl: supabaseUrl + functionPath,
    anonKey: props.supabaseAnonKey || "",
    // Extension bundle id = the app's bundle id + ".share" (e.g.
    // studio.styledinmotion.share). The App Group must be attached to THIS id.
    bundleIdentifier:
      props.bundleIdentifier ||
      `${config.ios && config.ios.bundleIdentifier}.share`,
    deploymentTarget: props.deploymentTarget || "15.1",
    developmentTeam: props.developmentTeam || "",
    appVersion: (config.version || "1.0").toString(),
    buildNumber: ((config.ios && config.ios.buildNumber) || "1").toString(),
  };
}

// 1. Write the extension's source + templated plist/entitlements into ios/.
function withExtensionFiles(config, props) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const p = resolveProps(cfg, props);
      const src = templateDir(cfg.modRequest.projectRoot);
      const destDir = path.join(cfg.modRequest.platformProjectRoot, TARGET_NAME);
      fs.mkdirSync(destDir, { recursive: true });

      // Swift is copied verbatim (reads its config from Info.plist at runtime).
      fs.copyFileSync(
        path.join(src, SWIFT_FILE),
        path.join(destDir, SWIFT_FILE)
      );

      const subs = {
        __APP_GROUP__: p.appGroup,
        __TOKEN_KEY__: p.tokenKey,
        __SUPABASE_URL__: p.supabaseUrl,
        __FUNCTION_URL__: p.functionUrl,
        __ANON_KEY__: p.anonKey,
        __APP_VERSION__: p.appVersion,
        __BUILD_NUMBER__: p.buildNumber,
      };
      for (const file of [INFO_PLIST, ENTITLEMENTS]) {
        let contents = fs.readFileSync(path.join(src, file), "utf8");
        for (const [token, value] of Object.entries(subs)) {
          contents = contents.split(token).join(value);
        }
        fs.writeFileSync(path.join(destDir, file), contents);
      }
      return cfg;
    },
  ]);
}

// 2. Create + wire the extension target in the Xcode project.
function withExtensionTarget(config, props) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const p = resolveProps(cfg, props);

    // Idempotent: bail if a prior prebuild already added the target.
    if (project.pbxTargetByName(TARGET_NAME)) return cfg;

    // Known `xcode` bug: addTarget's dependency wiring needs these sections to
    // exist. A single-target project (fresh prebuild) doesn't have them yet.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

    // Group holding the extension's files (creates PBXFileReferences).
    const group = project.addPbxGroup(
      [SWIFT_FILE, INFO_PLIST, ENTITLEMENTS],
      TARGET_NAME,
      TARGET_NAME
    );
    // Attach the new group under the project's main (nameless/pathless) group.
    const groups = project.hash.project.objects.PBXGroup;
    Object.keys(groups).forEach((key) => {
      if (
        typeof groups[key] === "object" &&
        groups[key].name === undefined &&
        groups[key].path === undefined
      ) {
        project.addToPbxGroup(group.uuid, key);
      }
    });

    // The app_extension target — auto-embeds into the app + adds the dependency.
    const target = project.addTarget(
      TARGET_NAME,
      "app_extension",
      TARGET_NAME,
      p.bundleIdentifier
    );

    // Build phases for the new target.
    project.addBuildPhase(
      [SWIFT_FILE],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid
    );
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      target.uuid
    );

    // Correct the extension's build settings (both Debug + Release configs).
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      const bs = configurations[key].buildSettings;
      if (bs && bs.PRODUCT_NAME === `"${TARGET_NAME}"`) {
        bs.INFOPLIST_FILE = `"${TARGET_NAME}/${INFO_PLIST}"`;
        bs.CODE_SIGN_ENTITLEMENTS = `"${TARGET_NAME}/${ENTITLEMENTS}"`;
        bs.CODE_SIGN_STYLE = "Automatic";
        bs.SWIFT_VERSION = "5.0";
        bs.TARGETED_DEVICE_FAMILY = `"1,2"`;
        bs.IPHONEOS_DEPLOYMENT_TARGET = p.deploymentTarget;
        bs.MARKETING_VERSION = p.appVersion;
        bs.CURRENT_PROJECT_VERSION = p.buildNumber;
        bs.GENERATE_INFOPLIST_FILE = "NO";
        if (p.developmentTeam) bs.DEVELOPMENT_TEAM = p.developmentTeam;
      }
    }

    return cfg;
  });
}

function withShareExtension(config, props = {}) {
  config = withExtensionFiles(config, props);
  config = withExtensionTarget(config, props);
  return config;
}

module.exports = createRunOncePlugin(
  withShareExtension,
  pkg.name,
  pkg.version
);
