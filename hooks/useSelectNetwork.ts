import { useCallback } from 'react';

import presentAlert from '../components/Alert';
import confirm from '../helpers/confirm';
import loc from '../loc';
import type { NetworkId } from '../modules/network';
import { useScanStatus } from './context/useScanState';
import { useStorage } from './context/useStorage';

/**
 * Switch chains on the user's behalf: asks before abandoning a running scan, and reports a failed
 * switch instead of throwing.
 */
export const useSelectNetwork = (): ((next: NetworkId) => Promise<void>) => {
  const { activeNetworkId, switchNetwork, isSwitchingNetwork } = useStorage();
  const scanStatus = useScanStatus();

  return useCallback(
    async (next: NetworkId) => {
      if (next === activeNetworkId || isSwitchingNetwork) return;

      // A scan can take a long time; abandoning one silently would look like the app lost data.
      if (scanStatus === 'scanning') {
        const proceed = await confirm(loc.settings.network_switch_scan_title, loc.settings.network_switch_scan_message);
        if (!proceed) return;
      }

      try {
        await switchNetwork(next);
      } catch (error: any) {
        presentAlert({ title: loc.errors.error, message: error?.message ?? String(error) });
      }
    },
    [activeNetworkId, isSwitchingNetwork, switchNetwork, scanStatus],
  );
};
