import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { type Transaction } from '../../class/wallets/types';
import { TransactionListItem } from '../../components/TransactionListItem';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { CommonToolTipActions } from '../../typings/CommonToolTipActions';

jest.mock('../../hooks/context/useSettings');
jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/useExtendedNavigation', () => ({ useExtendedNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const tx = { hash: 'a'.repeat(64), value: 5234, confirmations: 10, timestamp: 1_700_000_000, inputs: [], outputs: [] };
const wallet = { getID: () => 'wallet', weOwnAddress: (address: string) => address === 'tb1pourmine' };

const renderRow = (isBalanceHidden: boolean, item: Partial<Transaction> = tx) => {
  (useSettings as jest.Mock).mockReturnValue({ isBalanceHidden });
  return render(
    <NavigationContainer>
      <TransactionListItem item={item as never} itemPriceUnit={BitcoinUnit.BTC} walletID="wallet" />
    </NavigationContainer>,
  );
};

// Long-presses the row and reports whether its menu offers to copy the amount.
const offersCopyAmount = async (screen: ReturnType<typeof render>) => {
  await act(async () => fireEvent(screen.getByTestId('TransactionListItem'), 'longPress'));
  return screen.queryByTestId(`ToolTipMenuItem-${CommonToolTipActions.CopyAmount.id}`) !== null;
};

describe('unit - TransactionListItem', () => {
  beforeEach(() => {
    (useStorage as jest.Mock).mockReturnValue({ txMetadata: {}, wallets: [wallet] });
  });

  it('shows the amount, with copying it on offer', async () => {
    const screen = renderRow(false);

    expect(screen.getByText('+0.00005234')).toBeTruthy();
    expect(await offersCopyAmount(screen)).toBe(true);
  });

  it('masks the amount while amounts are hidden, and stops offering to copy it', async () => {
    const screen = renderRow(true);

    expect(screen.queryByText('+0.00005234')).toBeNull();
    expect(screen.getByText('••••')).toBeTruthy();
    expect(await offersCopyAmount(screen)).toBe(false);
  });

  it("shows a receive by the address of ours it paid, not the sender's change", () => {
    const output = (n: number, address: string) => ({
      n,
      value: 0.0001,
      scriptPubKey: { asm: '', hex: '', reqSigs: 1, type: 'witness_v1_taproot', addresses: [address] },
    });
    const screen = renderRow(false, { ...tx, outputs: [output(0, 'tb1psenderchng'), output(1, 'tb1pourmine')] });

    expect(screen.getByText('tb1p...mine')).toBeTruthy();
    expect(screen.queryByText('tb1p...chng')).toBeNull();
  });
});
