module.exports = {
  appId: 'com.designerzen.wordtrail',
  productName: 'Word Trail',
  directories: { app: '.desktop-app', output: 'release', buildResources: 'build' },
  // The renderer is fully bundled; do not collect the parent workspace's
  // browser dependencies or their optional native inference binaries.
  files: ['dist/**/*', 'electron/**/*', 'package.json', '!node_modules{,/**/*}', '!**/node_modules{,/**/*}', '!dist/supertonic/assets/onnx/*.onnx'],
  asar: true,
  npmRebuild: false,
  artifactName: 'Word-Trail-${version}-${os}-${arch}.${ext}',
  mac: {
    target: ['dmg', 'zip'], icon: 'build/icons/icon.icns',
    category: 'public.app-category.productivity',
    // Ad-hoc signing supports Apple silicon without publisher credentials.
    // Use a Developer ID identity + hardenedRuntime when adding notarization.
    identity: '-', hardenedRuntime: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Word Trail records your microphone to transcribe speech on your device.',
      NSLocationUsageDescription: 'Word Trail can attach your location to recorded phrases.'
    }
  },
  win: { target: ['nsis'], icon: 'build/icons/icon.ico', artifactName: 'Word-Trail-${version}-windows-${arch}.${ext}' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true },
  linux: { target: ['AppImage', 'deb'], executableName: 'word-trail', icon: 'build/icons', category: 'AudioVideo', maintainer: 'designerzen', desktop: { entry: { StartupWMClass: 'word-trail' } } },
  publish: null
};
