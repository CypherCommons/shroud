import * as Electrum from '../../modules/Electrum';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet.ts';
import { type SilentPaymentUTXO } from '../../helpers/silent-payments/types.ts';

jest.mock('../../modules/Electrum', () => ({
  multiGetUtxoByAddress: jest.fn(),
  multiGetHistoryByAddress: jest.fn(),
}));

const coin = (txid: string, address: string): SilentPaymentUTXO => ({
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

describe('markSpentSilentPaymentUTXOs', () => {
  it('marks only coins Electrum knows but no longer lists as unspent', async () => {
    const wallet = new HDSilentPaymentsWallet();
    // a: spent elsewhere · b: still unspent · c: Electrum hasn't seen its funding tx yet
    (wallet as any)._utxo = [coin('aa', 'addr-a'), coin('bb', 'addr-b'), coin('cc', 'addr-c')];

    (Electrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({
      'addr-a': [],
      'addr-b': [{ txid: 'bb', vout: 0 }],
      'addr-c': [],
    });
    (Electrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({
      'addr-a': [{ tx_hash: 'aa' }, { tx_hash: 'spender' }],
      'addr-b': [{ tx_hash: 'bb' }],
      'addr-c': [],
    });

    await (wallet as any).markSpentSilentPaymentUTXOs();

    expect(wallet.getUTXOs().map(u => u.txid)).toEqual(['bb', 'cc']);
  });

  it('changes nothing when Electrum fails', async () => {
    const wallet = new HDSilentPaymentsWallet();
    (wallet as any)._utxo = [coin('aa', 'addr-a')];
    (Electrum.multiGetUtxoByAddress as jest.Mock).mockRejectedValue(new Error('offline'));

    await (wallet as any).markSpentSilentPaymentUTXOs();

    expect(wallet.getUTXOs()).toHaveLength(1);
  });
});
