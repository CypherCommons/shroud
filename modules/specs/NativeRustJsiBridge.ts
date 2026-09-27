import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /**
   * The native module installs the `spScan*` JSI functions on the JS runtime as soon as React Native
   * creates it (TurboModuleWithJSIBindings on Android, RCTTurboModuleWithJSIBindings on iOS), so by
   * the time this can be called the functions are in place. Always returns true.
   */
  install(): boolean;
}

export default TurboModuleRegistry.get<Spec>('RustJsiBridge');
