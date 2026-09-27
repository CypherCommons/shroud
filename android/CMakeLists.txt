cmake_minimum_required(VERSION 3.13)

# The New Architecture loads libappmodules.so for autolinked C++ modules, Fabric components and
# this app's codegen (ShroudSpecs). React Native only builds it itself when the app has no
# CMakeLists of its own, so it is built here next to the Rust JSI bridge.
project(appmodules)
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

# Rust JSI bridge, loaded by RustJsiBridgeModule.kt
add_library(
    rust-jsi-bridge
    SHARED
    app/src/main/cpp/RustJsiBridge.cpp
    app/src/main/cpp/rust-jsi-bridge-jni.cpp
)

target_include_directories(
    rust-jsi-bridge
    PRIVATE
    app/src/main/cpp
)

target_compile_features(rust-jsi-bridge PRIVATE cxx_std_20)
target_compile_options(rust-jsi-bridge PRIVATE -O2 -frtti -fexceptions -Wall -fstack-protector-all)

# Import Rust static library
add_library(rust_jsi_bridge_static STATIC IMPORTED)
set_target_properties(
    rust_jsi_bridge_static
    PROPERTIES IMPORTED_LOCATION
    ${CMAKE_SOURCE_DIR}/app/src/main/jniLibs/${ANDROID_ABI}/librust_jsi_bridge.a
)

# jsi, reactnative, fbjni and common_flags are defined by ReactNative-application.cmake
target_link_libraries(
    rust-jsi-bridge
    common_flags
    jsi
    reactnative
    fbjni
    rust_jsi_bridge_static
    android
    log
)
