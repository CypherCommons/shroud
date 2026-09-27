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
};

module.exports = config;
