import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import * as Updates from 'expo-updates';

import { isUpdateGateEnabled } from '../helpers/e2e';
import { isUpdateRequired, parseBuildNumber, resolvePolicy, UpdatePolicy } from '../modules/updatePolicy';

/**
 * Whether this build is below the update server's minimum and has to be updated from the store.
 *
 * `undefined` until the saved policy has been read, so nothing behind "Update required" (the unlock and
 * its Face ID prompt) starts on a launch that turns out blocked. After that it follows the server's
 * answer, asked once per launch.
 */
export const useUpdateRequired = (): boolean | undefined => {
  // Decided once per mount rather than when the module loads, so tests can set __DEV__ first.
  const [enabled] = useState(isUpdateGateEnabled);
  const [policy, setPolicy] = useState<UpdatePolicy | null | undefined>(enabled ? undefined : null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const apply = (next: UpdatePolicy | null) => {
      if (active) setPolicy(next);
    };
    // '' when expo-updates is off. The native config's channel is production as well.
    resolvePolicy(Updates.channel || 'production', apply).then(apply);
    return () => {
      active = false;
    };
  }, [enabled]);

  if (policy === undefined) return undefined;
  return isUpdateRequired(policy, Platform.OS, parseBuildNumber(DeviceInfo.getBuildNumber()));
};
