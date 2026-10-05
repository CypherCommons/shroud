#!/usr/bin/env bash
# Runs on EAS Build workers before dependencies are installed ("eas-build-pre-install" in package.json).
# - Writes .env for react-native-dotenv from whichever indexer overrides the build's EAS environment
#   sets. They're all optional: every network ships its own indexer in modules/network.ts.
# - Builds the Rust JSI bridge static libraries, which are not committed.
set -euo pipefail

# The names App.tsx imports from '@env'.
env_file=""
for name in INDEXER_BASE_URL INDEXER_BASE_URL_MAINNET INDEXER_BASE_URL_TESTNET4 INDEXER_BASE_URL_SIGNET \
  INDEXER_ONION_URL INDEXER_ONION_URL_TESTNET4 INDEXER_ONION_URL_SIGNET; do
  if [ -n "${!name:-}" ]; then
    env_file+="$name=${!name}"$'\n'
  fi
done
if [ -n "$env_file" ]; then
  printf '%s' "$env_file" > .env
fi

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
