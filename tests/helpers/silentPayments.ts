import type { SilentPaymentUTXO } from '../../helpers/silent-payments/types';
import * as indexerModule from '../../modules/SilentPaymentIndexer';

/** The chain tip the stub indexer reports unless told otherwise. */
export const TIP = 900_000;

/** Makes getDefaultIndexer hand out a stub, caught up at TIP and with nothing to scan unless overridden. */
export const stubIndexer = (overrides: Record<string, any> = {}) => {
  const indexer = {
    getLatestBlockHeight: jest.fn().mockResolvedValue({ height: TIP }),
    getBlockHeightByTimestamp: jest.fn(),
    scanForwardWithCallback: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  jest.spyOn(indexerModule, 'getDefaultIndexer').mockReturnValue(indexer as any);
  return indexer;
};

/** An unspent silent payment coin of ours, paid to `address`. */
export const spCoin = (txid: string, address: string): SilentPaymentUTXO => ({
  txid,
  vout: 0,
  value: 1000,
  height: 1,
  address,
  silentPaymentAddress: '',
  pubKey: '',
  tweak: new Uint8Array(32),
  blockHash: '',
  blockTime: 0,
  isSpent: false,
});
