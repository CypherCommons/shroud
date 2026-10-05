import { NavigationContainer } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SizeClassProvider } from './components/Context/SizeClassProvider';
import { SettingsProvider } from './components/Context/SettingsProvider';
import { getEffectiveTheme } from './components/themes';
import { ContactsProvider } from './components/Context/ContactsProvider';
import MasterView from './navigation/MasterView';
import { markNavigationReady, navigationRef } from './NavigationService';
import { useLogger } from '@react-navigation/devtools';
import { StorageProvider } from './components/Context/StorageProvider';
import { useSettings } from './hooks/context/useSettings';
import { initializeRustJsiBridge } from './modules/RustJsiBridge';
import { configureIndexerEndpoints, getNetwork } from './modules/network';
import { bootActiveNetwork } from './modules/networkPreference';
import presentAlert from './components/Alert';
import { useColorScheme } from 'react-native';

// Optional indexer overrides. Expo CLI inlines EXPO_PUBLIC_* variables at bundle time, from .env
// locally and from the EAS environment in builds and `eas update --environment`. Only direct
// `process.env.EXPO_PUBLIC_*` reads are inlined.
const INDEXER_BASE_URL = process.env.EXPO_PUBLIC_INDEXER_BASE_URL;
const INDEXER_BASE_URL_MAINNET = process.env.EXPO_PUBLIC_INDEXER_BASE_URL_MAINNET;
const INDEXER_BASE_URL_TESTNET4 = process.env.EXPO_PUBLIC_INDEXER_BASE_URL_TESTNET4;
const INDEXER_BASE_URL_SIGNET = process.env.EXPO_PUBLIC_INDEXER_BASE_URL_SIGNET;
const INDEXER_ONION_URL = process.env.EXPO_PUBLIC_INDEXER_ONION_URL;
const INDEXER_ONION_URL_TESTNET4 = process.env.EXPO_PUBLIC_INDEXER_ONION_URL_TESTNET4;
const INDEXER_ONION_URL_SIGNET = process.env.EXPO_PUBLIC_INDEXER_ONION_URL_SIGNET;

const ThemedNavigationContainer = () => {
  const colorScheme = useColorScheme();
  const { themePreference, settingsLoaded } = useSettings();

  useLogger(navigationRef);

  if (!settingsLoaded) return null;

  return (
    <NavigationContainer ref={navigationRef} onReady={markNavigationReady} theme={getEffectiveTheme(themePreference, colorScheme)}>
      <MasterView />
    </NavigationContainer>
  );
};

const App = () => {
  // The provider tree does not mount until the active network is known. StorageProvider loads
  // wallets on mount and `getActiveNetwork()` is synchronous with a mainnet default, so mounting
  // first and hydrating after would briefly show the wrong chain's wallets — and worse, let a
  // scan start against the wrong indexer.
  const [networkReady, setNetworkReady] = useState(false);

  useEffect(() => {
    // The only place that reads the environment: the network registry is a leaf module so wallet
    // classes (and their unit tests) can import it without any build-time inlining. Every network
    // ships its own indexer addresses; these are optional overrides, and a blank one is ignored.
    configureIndexerEndpoints(
      {
        // EXPO_PUBLIC_INDEXER_BASE_URL is the old single-network name, still honoured for mainnet.
        bitcoin: INDEXER_BASE_URL_MAINNET || INDEXER_BASE_URL,
        testnet4: INDEXER_BASE_URL_TESTNET4,
        signet: INDEXER_BASE_URL_SIGNET,
      },
      // Each chain's own onion address; EXPO_PUBLIC_INDEXER_ONION_URL is mainnet's. A shared one
      // would route test-chain scans to the mainnet indexer over Tor.
      {
        bitcoin: INDEXER_ONION_URL,
        testnet4: INDEXER_ONION_URL_TESTNET4,
        signet: INDEXER_ONION_URL_SIGNET,
      },
    );

    initializeRustJsiBridge();

    bootActiveNetwork()
      .then(({ id, fellBackFrom, reason }) => {
        if (fellBackFrom) {
          const from = getNetwork(fellBackFrom).displayName;
          const why = reason === 'disabled' ? `${from} is currently disabled` : `No silent payment indexer is configured for ${from}`;
          presentAlert({ message: `${why}, so the app started on ${getNetwork(id).displayName} instead.` });
        }
      })
      .catch((error: any) => {
        presentAlert({ message: error?.message ?? String(error) });
      })
      .finally(() => setNetworkReady(true));
  }, []);

  if (!networkReady) return null;

  return (
    // Edge-to-edge Android no longer resizes the window for the keyboard, so keyboard avoidance
    // comes from react-native-keyboard-controller on both platforms.
    <KeyboardProvider>
      <SizeClassProvider>
        <SafeAreaProvider>
          <StorageProvider>
            <SettingsProvider>
              <ContactsProvider>
                <ThemedNavigationContainer />
              </ContactsProvider>
            </SettingsProvider>
          </StorageProvider>
        </SafeAreaProvider>
      </SizeClassProvider>
    </KeyboardProvider>
  );
};

export default App;
