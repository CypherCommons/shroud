package org.bitshala.shroud

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.BindingsInstallerHolder
import com.facebook.react.turbomodule.core.interfaces.TurboModuleWithJSIBindings

/**
 * Exposes the Rust silent-payments scanner to JS. React Native calls [getBindingsInstaller] on the
 * JS thread when it creates this module; the installer adds the `spScan*` JSI functions to the
 * runtime (see cpp/rust-jsi-bridge-jni.cpp).
 */
@ReactModule(name = RustJsiBridgeModule.NAME)
class RustJsiBridgeModule(reactContext: ReactApplicationContext) :
    NativeRustJsiBridgeSpec(reactContext), TurboModuleWithJSIBindings {

  external override fun getBindingsInstaller(): BindingsInstallerHolder

  // The bindings are installed when the module is created, so there is nothing left to do here.
  override fun install(): Boolean = true

  companion object {
    const val NAME = NativeRustJsiBridgeSpec.NAME

    init {
      System.loadLibrary("rust-jsi-bridge")
    }
  }
}
