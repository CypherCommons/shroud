#!/usr/bin/env bash

# exit on error, pipe failure, or undefined variables (prevents silent failures)
set -euo pipefail

PROJECT_NAME="rust_jsi_bridge"
LIB_NAME="librust_jsi_bridge.a"
IOS_DEST="../ios"
ANDROID_DEST_BASE="../android/app/src/main/jniLibs"
API_LEVEL=21 # Minimum API level for Android builds (Android 5.0+, Lollipop)
# Minimum iOS version for iOS builds; keep in sync with ios/Podfile.properties.json (ios.deploymentTarget).
# rustc and the cc crate (secp256k1's C code) default to the SDK version when this is unset.
IOS_DEPLOYMENT_TARGET="16.4"

detect_ndk_home() {
    if [ -n "${ANDROID_NDK_HOME:-}" ]; then
        return 0
    fi

    if [ -d "${ANDROID_HOME:-}/ndk" ]; then
        local ndk_version
        ndk_version=$(ls -1 "${ANDROID_HOME}/ndk" | sort -V | tail -1)
        export ANDROID_NDK_HOME="${ANDROID_HOME}/ndk/${ndk_version}"
        echo "ℹ️  Setting ANDROID_NDK_HOME to ${ANDROID_NDK_HOME}"
    else
        echo "❌ Error: ANDROID_NDK_HOME not set and NDK not found in ANDROID_HOME"
        echo "Please set ANDROID_NDK_HOME environment variable to your NDK installation path"
        echo "Example: export ANDROID_NDK_HOME=~/Android/Sdk/ndk/27.1.12297006"
        exit 1
    fi
}

configure_android_toolchain() {
    detect_ndk_home

    local host_tag
    case "$(uname -s)" in
        Darwin) host_tag="darwin-x86_64" ;;
        Linux)  host_tag="linux-x86_64" ;;
        *) error "Unsupported host OS for NDK toolchain: $(uname -s)" ;;
    esac
    local toolchain="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/${host_tag}/bin"

    if [ ! -d "$toolchain" ]; then
        error "NDK toolchain not found at $toolchain"
    fi

    export PATH="$toolchain:${PATH}"

    # NDK 28+ uses llvm-ar for all architectures instead of architecture-specific ar tools
    # align with .cargo/config.toml linker settings
    export CC_aarch64_linux_android="${toolchain}/aarch64-linux-android${API_LEVEL}-clang"
    export AR_aarch64_linux_android="${toolchain}/llvm-ar"

    export CC_armv7_linux_androideabi="${toolchain}/armv7a-linux-androideabi${API_LEVEL}-clang"
    export AR_armv7_linux_androideabi="${toolchain}/llvm-ar"

    export CC_x86_64_linux_android="${toolchain}/x86_64-linux-android${API_LEVEL}-clang"
    export AR_x86_64_linux_android="${toolchain}/llvm-ar"

    export CC_i686_linux_android="${toolchain}/i686-linux-android${API_LEVEL}-clang"
    export AR_i686_linux_android="${toolchain}/llvm-ar"

    success "Android NDK toolchain configured"
}

# map rust targets to descriptive names and destination paths
# format: "target_triple|display_name|destination_subdir"
ANDROID_TARGETS=(
    "aarch64-linux-android|Android ARM64|arm64-v8a"
    "armv7-linux-androideabi|Android ARMv7|armeabi-v7a"
    "x86_64-linux-android|Android x86_64|x86_64"
    "i686-linux-android|Android x86|x86"
)

IOS_TARGETS=(
    "aarch64-apple-ios|iOS Device (ARM64)"
    "aarch64-apple-ios-sim|iOS Simulator (ARM64)"
    "x86_64-apple-ios|iOS Simulator (x86_64)"
)


log() { echo -e "\033[1;34m$1\033[0m"; }
success() { echo -e "\033[1;32m  ✅ $1\033[0m"; }
warn() { echo -e "\033[1;33m  ⚠️  $1\033[0m"; }
error() { echo -e "\033[1;31m❌ $1\033[0m"; exit 1; }

is_macos() {
    [[ "$(uname -s)" == "Darwin" ]]
}

ensure_rust_targets() {
    local platform="$1"
    log "Checking Rust targets..."

    local targets=()
    if [ "$platform" = "ios" ]; then
        targets=(
            "aarch64-apple-ios"
            "aarch64-apple-ios-sim"
            "x86_64-apple-ios"
        )
    else
        targets=(
            "aarch64-linux-android"
            "armv7-linux-androideabi"
            "x86_64-linux-android"
            "i686-linux-android"
        )
    fi
    
    local installed_targets
    installed_targets=$(rustup target list --installed)
    
    local missing_targets=()
    
    for target in "${targets[@]}"; do
        if ! echo "$installed_targets" | grep -q "^${target}$"; then
            missing_targets+=("$target")
        fi
    done
    
    if [ ${#missing_targets[@]} -gt 0 ]; then
        log "Installing missing targets: ${missing_targets[*]}"
        for target in "${missing_targets[@]}"; do
            rustup target add "$target" || warn "Failed to install $target"
        done
    else
        success "All Rust targets already installed"
    fi
}

build_and_copy_android() {
    IFS='|' read -r target name subdir <<< "$1"
    log "Building $name ($target)..."
    
    if cargo build --release --target "$target"; then
        mkdir -p "$ANDROID_DEST_BASE/$subdir"
        cp "target/$target/release/$LIB_NAME" "$ANDROID_DEST_BASE/$subdir/"
        success "$name built and deployed"
    else
        warn "$name build failed. Try: rustup target add $target"
    fi
}

build_ios_target() {
    IFS='|' read -r target name <<< "$1"
    log "Building $name ($target)..."

    if IPHONEOS_DEPLOYMENT_TARGET="$IOS_DEPLOYMENT_TARGET" cargo build --release --target "$target"; then
        success "$name built successfully"
        return 0
    else
        warn "$name build failed. Try: rustup target add $target"
        return 1
    fi
}

create_ios_xcframework() {
    log "Creating iOS XCFramework..."

    mkdir -p "$IOS_DEST"

    local device_lib="target/aarch64-apple-ios/release/$LIB_NAME"
    local sim_arm_lib="target/aarch64-apple-ios-sim/release/$LIB_NAME"
    local sim_x86_lib="target/x86_64-apple-ios/release/$LIB_NAME"

    if [ ! -f "$device_lib" ] || [ ! -f "$sim_arm_lib" ]; then
        warn "Missing iOS .a files; skipping XCFramework creation"
        return
    fi

    # Merge simulator slices so one .a covers both sim archs (x86_64 slice optional)
    local sim_lib="target/universal-ios-simulator/$LIB_NAME"
    mkdir -p "$(dirname "$sim_lib")"
    if [ -f "$sim_x86_lib" ]; then
        lipo -create "$sim_arm_lib" "$sim_x86_lib" -output "$sim_lib"
    else
        cp "$sim_arm_lib" "$sim_lib"
    fi

    rm -rf "$IOS_DEST/RustJsiBridge.xcframework"
    xcodebuild -create-xcframework \
        -library "$device_lib" \
        -library "$sim_lib" \
        -output "$IOS_DEST/RustJsiBridge.xcframework" >/dev/null
    success "XCFramework written to $IOS_DEST/RustJsiBridge.xcframework"
}


main() {
    if [[ ! -f "Cargo.toml" && -d "$PROJECT_NAME" ]]; then
        cd "$PROJECT_NAME"
    fi

    if [[ ! -f "Cargo.toml" ]]; then
        error "Must run from the root or the $PROJECT_NAME directory."
    fi

    echo "🦀 Starting Rust JSI Bridge Build System"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if is_macos; then
        if [[ "${IOS_ONLY:-0}" == "1" ]]; then
            # Skip Android when only the iOS xcframework is needed (e.g. EAS iOS builds without NDK)
            log "IOS_ONLY=1 — building iOS targets only."
            ensure_rust_targets "ios"

            echo -e "\n📱 iOS Targets:"
            for item in "${IOS_TARGETS[@]}"; do
                build_ios_target "$item"
            done

            echo
            create_ios_xcframework
            echo -e "\n✅ iOS-only Build Complete!"
            return 0
        fi

        log "Detected macOS host. Building iOS + Android targets."
        ensure_rust_targets "ios"
        configure_android_toolchain
        ensure_rust_targets "android"

        echo -e "\n📱 iOS Targets:"
        for item in "${IOS_TARGETS[@]}"; do
            build_ios_target "$item"
        done

        echo -e "\n🤖 Android Targets:"
        for item in "${ANDROID_TARGETS[@]}"; do
            build_and_copy_android "$item"
        done

        echo
        create_ios_xcframework
    else
        log "Non-macOS host detected. Building Android targets only."
        configure_android_toolchain
        ensure_rust_targets "android"

        echo -e "\n🤖 Android Targets:"
        for item in "${ANDROID_TARGETS[@]}"; do
            build_and_copy_android "$item"
        done
    fi

    echo -e "\n✅ Build and Distribution Complete!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    log "Final Assets Statistics:"
    if is_macos; then
        echo "📱 iOS libraries:"
        find "target" -path "*/release/$LIB_NAME" -name "$LIB_NAME" 2>/dev/null | while read -r file; do
            ls -lh "$file" | awk '{print "  " $5 "\t" $9}'
        done || echo "  No iOS artifacts found."
        echo "📦 Android libraries:"
        find "$ANDROID_DEST_BASE" -name "*.a" -exec ls -lh {} + 2>/dev/null | awk '{print "  " $5 "\t" $9}' || echo "  No Android artifacts found."
    else
        echo "📦 Android libraries:"
        find "$ANDROID_DEST_BASE" -name "*.a" -exec ls -lh {} + 2>/dev/null | awk '{print "  " $5 "\t" $9}' || echo "  No Android artifacts found."
    fi
    
    # echo "\n📱 iOS libraries:"
    # find "$IOS_DEST" -name "*.a" -o -name "*.xcframework" 2>/dev/null | while read -r file; do
    #     if [ -f "$file" ]; then
    #         ls -lh "$file" | awk '{print "  " $5 "\t" $9}'
    #     elif [ -d "$file" ]; then
    #         echo "  [XCFramework] $file"
    #     fi
    # done || echo "  No iOS artifacts found."
}

main "$@"
