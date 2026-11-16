/**
 * Packaging. A plain script instead of the `build` field in package.json, because macOS
 * signing depends on whether a certificate is at hand.
 *
 * With a Developer ID certificate (CSC_LINK or CSC_NAME in the environment, as in the release
 * workflow) the app is signed, hardened and notarized, and macOS opens it without objection.
 * Without one, as on a developer's machine, it gets an ad-hoc signature: it runs where it was
 * built, and Gatekeeper asks once on other Macs.
 */
const signed = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)
const notarized = signed && Boolean(process.env.APPLE_API_KEY || process.env.APPLE_APP_SPECIFIC_PASSWORD)

const macSigning = signed
  ? {
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      notarize: notarized,
    }
  // Ad-hoc with the hardened runtime would need the same entitlements to start at all.
  : { identity: '-', hardenedRuntime: false }

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.podium.app',
  productName: 'Podium',
  directories: { output: 'release', buildResources: 'build' },
  files: ['out/**/*', 'package.json'],
  extraResources: [
    { from: 'launcher', to: 'launcher', filter: ['launcher.mjs', 'bridge-client.js'] },
    { from: 'templates', to: 'templates' },
    { from: 'build/npm.zip', to: 'npm.zip' },
    { from: 'build/runtime-seed', to: 'runtime-seed' },
  ],
  fileAssociations: [{ ext: 'podium', name: 'Podium-Präsentation', role: 'Editor' }],
  // The feed files (latest*.yml) are written for this provider; the release workflow uploads them.
  publish: [{ provider: 'github', owner: 'Rasalas', repo: 'Podium' }],
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Office',
    maintainer: 'Podium contributors <podium@localhost>',
    syncDesktopName: true,
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      // The zip is what an installed app updates itself from.
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.productivity',
    artifactName: '${productName}-${version}-${arch}.${ext}',
    extendInfo: {
      // Slidev's presenter view can show the speaker's camera and record the talk.
      NSCameraUsageDescription: 'Slidev kann dein Kamerabild in der Präsentation zeigen.',
      NSMicrophoneUsageDescription: 'Slidev kann deinen Vortrag aufnehmen.',
    },
    ...macSigning,
  },
  win: { target: ['nsis'] },
  nsis: { artifactName: '${productName}-Setup-${version}.${ext}' },
}
