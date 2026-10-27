import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render } from '@testing-library/react-native';

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
// A host view standing in for the native menu, so the test can read the actions it was given.
jest.mock('@react-native-menu/menu', () => {
  const { View } = jest.requireActual('react-native');
  return { MenuView: (props: object) => <View testID="MenuView" {...props} /> };
});

const tx = { hash: 'a'.repeat(64), value: 5234, confirmations: 10, timestamp: 1_700_000_000, inputs: [], outputs: [] };
const wallet = { getID: () => 'wallet', weOwnAddress: (address: string) => address === 'tb1pourmine' };

const renderRow = (isBalanceHidden: boolean, item: object = tx) => {
  (useSettings as jest.Mock).mockReturnValue({ isBalanceHidden });
  return render(
    <NavigationContainer>
      <TransactionListItem item={item as never} itemPriceUnit={BitcoinUnit.BTC} walletID="wallet" />
    </NavigationContainer>,
  );
};

const copyAmountAction = (screen: ReturnType<typeof render>) =>
  screen.getByTestId('MenuView').props.actions.find((action: { id: string }) => action.id === CommonToolTipActions.CopyAmount.id);

describe('unit - TransactionListItem', () => {
  beforeEach(() => {
    (useStorage as jest.Mock).mockReturnValue({ txMetadata: {}, wallets: [wallet] });
  });

  it('shows the amount, with copying it on offer', () => {
    const screen = renderRow(false);

    expect(screen.getByText('+0.00005234')).toBeTruthy();
    expect(copyAmountAction(screen).attributes.hidden).toBeFalsy();
  });

  it('masks the amount while amounts are hidden, and stops offering to copy it', () => {
    const screen = renderRow(true);

    expect(screen.queryByText('+0.00005234')).toBeNull();
    expect(screen.getByText('••••')).toBeTruthy();
    expect(copyAmountAction(screen).attributes.hidden).toBe(true);
  });

  it("shows a receive by the address of ours it paid, not the sender's change", () => {
    const output = (n: number, address: string) => ({ n, value: 0.0001, scriptPubKey: { addresses: [address] } });
    const screen = renderRow(false, { ...tx, outputs: [output(0, 'tb1psenderchng'), output(1, 'tb1pourmine')] });

    expect(screen.getByText('tb1p...mine')).toBeTruthy();
    expect(screen.queryByText('tb1p...chng')).toBeNull();
  });
});
