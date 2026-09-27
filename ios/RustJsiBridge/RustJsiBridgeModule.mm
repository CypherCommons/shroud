#import "RustJsiBridgeModule.h"

#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>
#import <ShroudSpecs/ShroudSpecs.h>

#import "RustJsiBridge.h"

@interface RustJsiBridgeModule () <NativeRustJsiBridgeSpec, RCTTurboModuleWithJSIBindings>
@end

@implementation RustJsiBridgeModule

RCT_EXPORT_MODULE(RustJsiBridge)

// React Native calls this on the JS thread when it creates the module, before JS can use it.
- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callInvoker
{
  rustjsibridge::installJSIBindings(runtime);
}

// The bindings are installed when the module is created, so there is nothing left to do here.
- (NSNumber *)install
{
  return @YES;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeRustJsiBridgeSpecJSI>(params);
}

@end
