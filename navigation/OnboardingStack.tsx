import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OnboardingScreen from '../screen/wallets/OnboardingScreen';
import PleaseBackup from '../screen/wallets/PleaseBackup';
import { RouteProp } from '@react-navigation/native';
import { PortraitOnlyOptions } from './orientation';

type OnboardingStackParamList = {
  OnboardingMain: undefined;
  PleaseBackup: { walletID: string };
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

const OnboardingStack = ({ route }: { route?: RouteProp<any, any> }) => {
  const initialRouteName = route?.params?.screen || 'OnboardingMain';
  const initialParams = route?.params?.params || undefined;
  return (
    <Stack.Navigator
      screenOptions={{ ...PortraitOnlyOptions, headerShown: false, gestureEnabled: false, headerBackVisible: false }}
      initialRouteName={initialRouteName}
    >
      <Stack.Screen name="OnboardingMain" component={OnboardingScreen} />
      <Stack.Screen name="PleaseBackup" component={PleaseBackup} initialParams={initialParams} />
    </Stack.Navigator>
  );
};
export default OnboardingStack;
