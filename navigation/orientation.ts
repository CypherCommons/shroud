import { NativeStackNavigationOptions } from '@react-navigation/native-stack';

// Set on every native stack. Info.plist still allows landscape, and once any screen sets an
// orientation, react-native-screens overrides the Android manifest's portrait lock. A native lock
// needs a store build. 'portrait_up' because 'portrait' also allows upside-down.
export const PortraitOnlyOptions: NativeStackNavigationOptions = { orientation: 'portrait_up' };
