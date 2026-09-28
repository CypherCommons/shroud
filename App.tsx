import { NavigationContainer } from '@react-navigation/native';
import React, { useEffect } from 'react';
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
import { initializeIndexer } from './modules/SilentPaymentIndexer';
import { initializeRustJsiBridge } from './modules/RustJsiBridge';
import { INDEXER_BASE_URL, INDEXER_ONION_URL } from '@env';
import { useColorScheme } from 'react-native';

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
  useEffect(() => {
    if (!INDEXER_BASE_URL) throw new Error('INDEXER_BASE_URL is not set');
    initializeRustJsiBridge();
    initializeIndexer({
      baseUrl: INDEXER_BASE_URL,
      onionUrl: INDEXER_ONION_URL,
      timeout: 100000,
    });
  }, []);

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
