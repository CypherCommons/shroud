#include <ReactCommon/BindingsInstallerHolder.h>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

#include "RustJsiBridge.h"

namespace {

// Native half of org.bitshala.shroud.RustJsiBridgeModule#getBindingsInstaller.
struct JRustJsiBridgeModule : facebook::jni::JavaClass<JRustJsiBridgeModule> {
  static constexpr auto kJavaDescriptor = "Lorg/bitshala/shroud/RustJsiBridgeModule;";

  static facebook::jni::local_ref<facebook::react::BindingsInstallerHolder::javaobject>
  getBindingsInstaller(facebook::jni::alias_ref<JRustJsiBridgeModule> /* self */) {
    return facebook::react::BindingsInstallerHolder::newObjectCxxArgs(
        [](facebook::jsi::Runtime &runtime,
           const std::shared_ptr<facebook::react::CallInvoker> & /* callInvoker */) {
          rustjsibridge::installJSIBindings(runtime);
        });
  }

  static void registerNatives() {
    javaClassStatic()->registerNatives({
        makeNativeMethod("getBindingsInstaller", JRustJsiBridgeModule::getBindingsInstaller),
    });
  }
};

} // namespace

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void * /* reserved */) {
  return facebook::jni::initialize(vm, [] { JRustJsiBridgeModule::registerNatives(); });
}
