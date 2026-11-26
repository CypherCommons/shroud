import * as Electrum from '../../modules/Electrum';
import type { ChainPort } from './PaymentTracker';

/** The tracker's view of the chain: confirmations from Electrum, blocks from its header subscription. */
export const electrumChain: ChainPort = {
  async getConfirmations(txid) {
    const found = (await Electrum.multiGetTransactionByTxid([txid], true))[txid];
    return found ? (found.confirmations ?? 0) : null;
  },
  onNewBlock: listener => Electrum.onNewBlock(() => listener()),
};
