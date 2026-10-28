import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import React, { lazy, Suspense } from 'react';
import { useColorScheme } from 'react-native';
import UnlockWith from '../screen/UnlockWith';
import { LazyLoadingIndicator } from './LazyLoadingIndicator';
import { DetailViewStackParamList } from './DetailViewStackParamList';
import { useStorage } from '../hooks/context/useStorage';
import { useSettings } from '../hooks/context/useSettings';
import { PortraitOnlyOptions } from './orientation';

// Lazy load all components except UnlockWith
const DrawerRoot = lazy(() => import('./DrawerRoot'));
const AddWalletStack = lazy(() => import('./AddWalletStack'));
const SendDetailsStack = lazy(() => import('./SendDetailsStack'));
const WalletExportStack = lazy(() => import('./WalletExportStack'));
const ScanQRCode = lazy(() => import('../screen/send/ScanQRCode'));

const NavigationDefaultOptions: NativeStackNavigationOptions = {
  headerShown: false,
  presentation: 'modal',
  headerShadowVisible: false,
};
const NavigationFormNoSwipeDefaultOptions: NativeStackNavigationOptions = {
  headerShown: false,
  presentation: 'modal',
  headerShadowVisible: false,
  fullScreenGestureEnabled: false,
};
const StatusBarLightOptions: NativeStackNavigationOptions = { statusBarStyle: 'light' };

const DetailViewStack = createNativeStackNavigator<DetailViewStackParamList>();

// Lazy loading wrapper components
const LazyDrawerRoot = () => (
  <Suspense fallback={<LazyLoadingIndicator />}>
    <DrawerRoot />
  </Suspense>
);

const LazyAddWalletStack = () => (
  <Suspense fallback={<LazyLoadingIndicator />}>
    <AddWalletStack />
  </Suspense>
);

const LazySendDetailsStack = () => (
  <Suspense fallback={<LazyLoadingIndicator />}>
    <SendDetailsStack />
  </Suspense>
);

const LazyWalletExportStack = () => (
  <Suspense fallback={<LazyLoadingIndicator />}>
    <WalletExportStack />
  </Suspense>
);

const LazyScanQRCodeComponent = () => (
  <Suspense fallback={<LazyLoadingIndicator />}>
    <ScanQRCode />
  </Suspense>
);

const MainRoot = () => {
  const { walletsInitialized } = useStorage();
  const colorScheme = useColorScheme();
  const { themePreference } = useSettings();
  const effectiveScheme = themePreference === 'system' ? colorScheme : themePreference;

  return (
    <DetailViewStack.Navigator
      screenOptions={{ ...PortraitOnlyOptions, headerShown: false, statusBarStyle: effectiveScheme === 'dark' ? 'light' : 'dark' }}
    >
      {!walletsInitialized ? (
        <DetailViewStack.Screen name="UnlockWithScreen" component={UnlockWith} />
      ) : (
        <>
          <DetailViewStack.Screen name="DrawerRoot" component={LazyDrawerRoot} />

          {/* Modal stacks */}
          <DetailViewStack.Screen
            name="AddWalletRoot"
            component={LazyAddWalletStack}
            options={{
              ...NavigationDefaultOptions,
              presentation: 'fullScreenModal',
              fullScreenGestureEnabled: false,
              gestureEnabled: false,
            }}
          />
          <DetailViewStack.Screen name="SendDetailsRoot" component={LazySendDetailsStack} options={NavigationFormNoSwipeDefaultOptions} />
          <DetailViewStack.Screen
            name="WalletExportRoot"
            component={LazyWalletExportStack}
            options={{ ...NavigationDefaultOptions, ...StatusBarLightOptions }}
          />

          <DetailViewStack.Screen
            name="ScanQRCode"
            component={LazyScanQRCodeComponent}
            options={{
              headerShown: false,
              statusBarHidden: true,
              presentation: 'fullScreenModal',
            }}
          />
        </>
      )}
    </DetailViewStack.Navigator>
  );
};

export default MainRoot;
export { DetailViewStack };
