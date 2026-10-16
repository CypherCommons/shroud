import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import navigationStyle from '../components/navigationStyle';
import { useTheme } from '../components/themes';
import loc from '../loc';
import { ImportSpeedComponent, ImportWalletComponent, PleaseBackupComponent } from './LazyLoadAddWalletStack';
import { ScanQRCodeComponent } from './LazyLoadScanQRCodeStack';
import { ScanQRCodeParamList } from './DetailViewStackParamList';

export type AddWalletStackParamList = {
  ImportWallet?: {
    onBarScanned?: string;
  };
  ImportSpeed: undefined;
  PleaseBackup: {
    walletID: string;
  };
  ScanQRCode: ScanQRCodeParamList;
};

const Stack = createNativeStackNavigator<AddWalletStackParamList>();

const AddWalletStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator initialRouteName="ImportWallet">
      <Stack.Screen name="ImportWallet" component={ImportWalletComponent} options={navigationStyle({ title: '' })(theme)} />
      <Stack.Screen
        name="ImportSpeed"
        component={ImportSpeedComponent}
        options={navigationStyle({ statusBarStyle: 'light', title: loc.wallets.import_title })(theme)}
      />
      <Stack.Screen
        name="PleaseBackup"
        component={PleaseBackupComponent}
        options={navigationStyle({
          gestureEnabled: false,
          headerShown: false,
        })(theme)}
      />
      <Stack.Screen
        name="ScanQRCode"
        component={ScanQRCodeComponent}
        options={navigationStyle({
          headerShown: false,
          statusBarHidden: true,
          presentation: 'fullScreenModal',
          headerShadowVisible: false,
        })(theme)}
      />
    </Stack.Navigator>
  );
};

export default AddWalletStack;
