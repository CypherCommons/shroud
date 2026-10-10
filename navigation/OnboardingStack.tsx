import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OnboardingScreen from '../screen/wallets/OnboardingScreen';

type OnboardingStackParamList = {
  OnboardingMain: undefined;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

// The backup screen lives in AddWalletStack: it reads the wallet being created from the storage
// provider, so it can't be opened from here with route params.
const OnboardingStack = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, gestureEnabled: false, headerBackVisible: false }}>
      <Stack.Screen name="OnboardingMain" component={OnboardingScreen} />
    </Stack.Navigator>
  );
};
export default OnboardingStack;
