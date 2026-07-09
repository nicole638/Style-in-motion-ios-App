// Expo config plugin — adds the `SimSharedDefaults` native module to the MAIN
// app target during `expo prebuild`.
//
// The JS (mobile/src/lib/share/deviceToken.ts) already resolves
// NativeModules.SimSharedDefaults and no-ops when absent. This plugin makes it
// present in a native build by copying the Swift implementation + its ObjC
// bridge into ios/<app>/ and registering both in the Xcode project's main
// target Sources build phase.
//
// Same mechanism family as ./withTikTokSDK.js (config-plugins, run at prebuild
// only — safe for `expo start`, which never executes the mods below).
const {
  withDangerousMod,
  withXcodeProject,
  IOSConfig,
  createRunOncePlugin,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const pkg = { name: "sim-shared-defaults", version: "1.0.0" };

const SOURCE_FILES = ["SimSharedDefaults.swift", "SimSharedDefaults.m"];

// Templates live alongside this plugin, under plugins/simSharedDefaults/.
// Derived from projectRoot (mobile/) to avoid Node's __dirname global, which the
// flat ESLint config doesn't permit.
function templateDir(projectRoot) {
  return path.join(projectRoot, "plugins", "simSharedDefaults");
}

// 1. Copy the Swift + ObjC bridge into ios/<projectName>/ next to AppDelegate.
function withCopiedSources(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const { platformProjectRoot, projectName, projectRoot } = cfg.modRequest;
      const destDir = path.join(platformProjectRoot, projectName);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of SOURCE_FILES) {
        fs.copyFileSync(
          path.join(templateDir(projectRoot), file),
          path.join(destDir, file)
        );
      }
      return cfg;
    },
  ]);
}

// 2. Register both files in the main target so they actually compile.
//
// This is a hand-rolled .pbxproj mutation, so its correctness depends on the
// build-time @expo/config-plugins + xcode toolchain. If a file ends up added to
// the project but NOT linked into the MAIN app target's Sources build phase, it
// never compiles → NativeModules.SimSharedDefaults is absent at runtime →
// mirrorToAppGroup() silently no-ops → the Share Extension reads an empty App
// Group ("Open the app and sign in"), while token minting (a network RPC) still
// looks healthy server-side. That failure is invisible in a git diff, so we
// make the registration explicit and verify it, logging loudly at prebuild if
// it didn't take.
function withSourcesInXcodeProject(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projectName = cfg.modRequest.projectName;

    // Resolve the MAIN app target explicitly (product type "application"). The
    // RN module must compile into the app's runtime — NOT the ShareExtension
    // (product type "app-extension") target. Passing an explicit targetUuid
    // makes this independent of plugin ordering and of config-plugins' default
    // target resolution (which is what could silently drift between build
    // images without any source change).
    const appTarget = project.getTarget("com.apple.product-type.application");
    if (!appTarget) {
      console.error(
        "[withSimSharedDefaults] Could not find the main app target " +
          "(com.apple.product-type.application). SimSharedDefaults will NOT be " +
          "compiled into the app and the share-extension App Group mirror will " +
          "silently no-op at runtime."
      );
      return cfg;
    }

    for (const file of SOURCE_FILES) {
      const relPath = `${projectName}/${file}`;
      // Idempotent: skip if already referenced (re-runs of prebuild).
      if (project.hasFile(relPath)) continue;
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: relPath,
        groupName: projectName,
        project,
        targetUuid: appTarget.uuid,
      });
    }

    // Verify each source actually landed in the main app target's Sources build
    // phase. If we can read the phase and a file is missing, that IS the
    // share-extension regression — surface it in the build log instead of
    // shipping a binary whose mirror can never write.
    const sourcesPhase = project.pbxSourcesBuildPhaseObj(appTarget.uuid);
    if (sourcesPhase && Array.isArray(sourcesPhase.files)) {
      const compiled = sourcesPhase.files.map((f) => (f && f.comment) || "");
      for (const file of SOURCE_FILES) {
        if (!compiled.some((c) => c.includes(file))) {
          console.error(
            `[withSimSharedDefaults] "${file}" is NOT in the main app target's ` +
              `Sources build phase after registration — it will not compile, so ` +
              `NativeModules.SimSharedDefaults will be missing at runtime and the ` +
              `App Group mirror will silently no-op. Inspect the ` +
              `@expo/config-plugins / xcode toolchain used for this build.`
          );
        }
      }
    }

    return cfg;
  });
}

function withSimSharedDefaults(config) {
  config = withCopiedSources(config);
  config = withSourcesInXcodeProject(config);
  return config;
}

module.exports = createRunOncePlugin(
  withSimSharedDefaults,
  pkg.name,
  pkg.version
);
