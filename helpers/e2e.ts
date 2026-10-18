import { LaunchArguments } from 'react-native-launch-arguments';

type E2ELaunchArgs = {
  detoxE2E?: boolean;
};

export const isE2E = (): boolean => {
  try {
    return LaunchArguments.value<E2ELaunchArgs>().detoxE2E === true;
  } catch {
    return false;
  }
};

/**
 * Whether the update screens (UpdateGate) may hold the app: release builds outside Detox. Development
 * builds never download over the air, and they and Detox's release APK are numbered 1, which a
 * production minimum would block.
 */
export const isUpdateGateEnabled = (): boolean => !__DEV__ && !isE2E();
