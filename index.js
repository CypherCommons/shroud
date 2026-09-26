import './gesture-handler';
import 'react-native-get-random-values';
import './shim.js';
// Expo's winter runtime polyfills TextDecoder/TextEncoder (missing in Hermes).
// Some bundled libs (e.g. ecpair's uint8array-tools) instantiate them at module
// top level. These polyfills were previously loaded via the expo-lib import
// chains; import them explicitly so Hermes has them regardless.
import 'expo/src/winter';

import React, { useEffect } from 'react';
import { AppRegistry, LogBox } from 'react-native';

import App from './App';
import A from './modules/analytics';
import { restoreSavedPreferredFiatCurrencyAndExchangeFromStorage } from './modules/currency';

if (!Error.captureStackTrace) {
  // captureStackTrace is only available when debugging
  Error.captureStackTrace = () => {};
}

LogBox.ignoreLogs([
  'Require cycle:',
  'Battery state `unknown` and monitoring disabled, this is normal for simulators and tvOS.',
  'Open debugger to view warnings.',
  'Non-serializable values were found in the navigation state',
]);

const ShroudAppComponent = () => {
  useEffect(() => {
    restoreSavedPreferredFiatCurrencyAndExchangeFromStorage();
    A(A.ENUM.INIT);
  }, []);

  return <App />;
};

AppRegistry.registerComponent('Shroud', () => ShroudAppComponent);
