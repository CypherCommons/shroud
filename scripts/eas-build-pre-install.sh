#!/usr/bin/env bash
# Runs on EAS Build workers before dependencies are installed ("eas-build-pre-install" in package.json).
# Points the build at its profile's update channel and builds the Rust JSI bridge static libraries,
# which are not committed. EXPO_PUBLIC_* variables come from the build's EAS environment and are
# inlined by Expo CLI, so no .env file is needed here.
set -euo pipefail

# EAS Build only applies eas.json's channel for EAS Update URLs, not for our update server.
node scripts/ota/set-build-channel.mjs "${EAS_BUILD_PROFILE:?}"

if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
export PATH="$HOME/.cargo/bin:$PATH"

# rust-native-setup.sh adds any missing Rust targets itself.
if [ "${EAS_BUILD_PLATFORM:-}" = "ios" ]; then
  IOS_ONLY=1 bash rust-native-setup.sh
else
  bash rust-native-setup.sh
fi
