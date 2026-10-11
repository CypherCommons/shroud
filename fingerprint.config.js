const { CHANNEL_HEADERS, setChannelHeader } = require('./scripts/ota/channel-header');

/**
 * Parts of files that differ between machines or build profiles without changing the native app.
 * They are blanked before hashing, so a build on EAS gets the runtime version that
 * `npm run ota:publish` computes from a checkout on a Mac.
 */
const NORMALIZE = {
  // Builds of different EAS profiles differ only in the update channel they ask for (see
  // scripts/ota/set-build-channel.mjs).
  ...Object.fromEntries(Object.keys(CHANNEL_HEADERS).map(file => [file, contents => setChannelHeader(file, contents, '').contents])),
  // ExpoModulesCore's precompiled podspec embeds the checkout's absolute path, so its checksum
  // changes with where the project lives (/Users/expo/workingdir/build on EAS).
  'ios/Podfile.lock': contents => contents.replace(/^( {2}ExpoModulesCore: )[0-9a-f]{40}$/m, '$1'),
};

// Per file being hashed, the chunks read so far of the files in NORMALIZE.
const pendingChunks = new WeakMap();

function fileHookTransform(source, chunk, isEndOfFile) {
  if (source.type !== 'file' || !Object.hasOwn(NORMALIZE, source.filePath)) return chunk;
  // Files arrive in 1 KB chunks: collect the whole file, then normalize it.
  const chunks = pendingChunks.get(source) ?? [];
  pendingChunks.set(source, chunks);
  if (chunk !== null) chunks.push(Buffer.from(chunk));
  if (!isEndOfFile) return null;
  return NORMALIZE[source.filePath](Buffer.concat(chunks).toString('utf8'));
}

/**
 * Inputs to the runtime version fingerprint (`runtimeVersion.policy: "fingerprint"` in app.json).
 * An OTA update only reaches builds with the same fingerprint, so everything that changes native
 * code must be hashed, and generated or machine-local files must not be (see .fingerprintignore).
 *
 * Check with: npx expo-updates fingerprint:generate --platform ios|android
 *
 * @type {import('expo/fingerprint').Config}
 */
const config = {
  extraSources: [
    // The Rust JSI bridge is compiled into the app but lives outside android/ and ios/.
    { type: 'dir', filePath: 'rust_jsi_bridge/src', reasons: ['rustJsiBridge'] },
    { type: 'file', filePath: 'rust_jsi_bridge/Cargo.toml', reasons: ['rustJsiBridge'] },
    { type: 'file', filePath: 'rust_jsi_bridge/Cargo.lock', reasons: ['rustJsiBridge'] },
    { type: 'file', filePath: 'rust_jsi_bridge/.cargo/config.toml', reasons: ['rustJsiBridge'] },
    { type: 'file', filePath: 'rust-native-setup.sh', reasons: ['rustJsiBridge'] },
    // TurboModule specs that codegen turns into native code.
    { type: 'dir', filePath: 'modules/specs', reasons: ['codegenSpecs'] },
  ],
  sourceSkips: [
    // Fingerprint's default.
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    // .gitignore does not change what ships in the binary.
    'GitIgnore',
  ],
  fileHookTransform,
};

module.exports = config;
