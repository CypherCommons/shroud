#!/bin/bash
set -euo pipefail

# set ANDROID_HOME based on OS, if not already set
if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  else
    export ANDROID_HOME="$HOME/Android/Sdk"
  fi
fi

export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$PATH"
BUNDLE_OUTPUT="android/app/src/main/assets/index.android.bundle"
RES_OUTPUT_DIR="android/app/src/main/res"
TMP_ASSETS_DIR="$(mktemp -d)"
COPIED_ASSETS_MANIFEST="$(mktemp)"

cleanup() {
  echo "Cleaning up generated React Native bundle assets..."
  rm -f "$BUNDLE_OUTPUT"

  if [[ -f "$COPIED_ASSETS_MANIFEST" ]]; then
    while IFS= read -r copied_file; do
      rm -f "$copied_file"
    done < "$COPIED_ASSETS_MANIFEST"
    rm -f "$COPIED_ASSETS_MANIFEST"
  fi

  if [[ -d "$RES_OUTPUT_DIR" ]]; then
    find "$RES_OUTPUT_DIR" -type d -empty -delete
  fi

  rm -rf "$TMP_ASSETS_DIR"
}
trap cleanup EXIT

mkdir -p "$(dirname "$BUNDLE_OUTPUT")"
mkdir -p "$RES_OUTPUT_DIR"

npx expo export:embed \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output "$BUNDLE_OUTPUT" \
  --assets-dest "$TMP_ASSETS_DIR"

if [[ -d "$TMP_ASSETS_DIR" ]]; then
  while IFS= read -r -d '' asset_file; do
    relative_path="${asset_file#"$TMP_ASSETS_DIR"/}"
    destination_file="$RES_OUTPUT_DIR/$relative_path"
    mkdir -p "$(dirname "$destination_file")"
    cp "$asset_file" "$destination_file"
    printf '%s\n' "$destination_file" >> "$COPIED_ASSETS_MANIFEST"
  done < <(find "$TMP_ASSETS_DIR" -type f -print0)
fi

npm run e2e:debug-build

echo "Done. Check out APK at: android/app/build/outputs/apk/debug/app-debug.apk"
