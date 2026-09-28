#!/usr/bin/env bash
# Runs on EAS Build workers before dependencies are installed ("eas-build-pre-install" in package.json).
# - Writes .env for react-native-dotenv from the build's EAS environment variables.
# - Builds the Rust JSI bridge static libraries, which are not committed.
set -euo pipefail

if [ -n "${INDEXER_BASE_URL:-}" ]; then
  printf 'INDEXER_BASE_URL=%s\n' "$INDEXER_BASE_URL" > .env
  if [ -n "${INDEXER_ONION_URL:-}" ]; then
    printf 'INDEXER_ONION_URL=%s\n' "$INDEXER_ONION_URL" >> .env
  fi
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
