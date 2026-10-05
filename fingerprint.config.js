const { CHANNEL_HEADERS, setChannelHeader } = require('./scripts/ota/channel-header');

// Per file being hashed, the chunks read so far of the files that name the update channel.
const channelFileChunks = new WeakMap();

/**
 * Builds of different EAS profiles differ only in the update channel they ask for (see
 * scripts/ota/set-build-channel.mjs). Hash them all with the channel blanked, so they get the
 * runtime version that `npm run ota:publish` computes from a checkout.
 */
function fileHookTransform(source, chunk, isEndOfFile) {
  if (source.type !== 'file' || !Object.hasOwn(CHANNEL_HEADERS, source.filePath)) return chunk;
  // Files arrive in 1 KB chunks: collect the whole file, then blank the channel.
  const chunks = channelFileChunks.get(source) ?? [];
  channelFileChunks.set(source, chunks);
  if (chunk !== null) chunks.push(Buffer.from(chunk));
  if (!isEndOfFile) return null;
  return setChannelHeader(source.filePath, Buffer.concat(chunks).toString('utf8'), '').contents;
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
