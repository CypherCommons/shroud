import { TScanError } from '../class/deeplink-schema-match';
import loc from '../loc';
import { getActiveNetwork } from '../modules/network';

/** Why a scanned code can't be paid, worded the same on every screen with a scanner. */
export const scanErrorMessage = (error: TScanError): string => {
  switch (error) {
    case 'wrong_network':
      return loc.formatString(loc.wallets.scan_wrong_network, { network: getActiveNetwork().displayName });
    case 'unrecognized':
      return loc.wallets.scan_unrecognized;
  }
};
