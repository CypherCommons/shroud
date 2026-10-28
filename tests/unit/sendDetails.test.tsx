import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import SendDetails from '../../screen/send/SendDetails';
import { useStorage } from '../../hooks/context/useStorage';
import { useContacts } from '../../hooks/context/useContacts';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { _setExchangeRate, _setPreferredFiatCurrency, _setSkipUpdateExchangeRate, getCurrencyCode } from '../../modules/currency';
import { FiatUnit } from '../../models/fiatUnit';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import loc, { formatBalance } from '../../loc';
import presentAlert from '../../components/Alert';
import { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { scanErrorMessage } from '../../helpers/scanErrorMessage';
import { SP_MAINNET, SP_MAINNET_2, SP_SIGNET } from '../fixtures/addresses';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/context/useContacts');
jest.mock('../../hooks/useExtendedNavigation');
jest.mock('../../components/Alert');
jest.mock('../../modules/hapticFeedback');
// iOS's InputAccessoryView has no native component under jest.
jest.mock('../../components/DismissKeyboardInputAccessory', () => ({ DismissKeyboardInputAccessory: () => null }));
// Hand-rolled for the same reasons as in importWallet.test.tsx: SafeArea needs insets, and useTheme a real NavigationContainer.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
}));
// Plain functions rather than jest.fn: the image-picker mock resets every mock before each test.
jest.mock('../../models/networkTransactionFees', () => {
  const actual = jest.requireActual('../../models/networkTransactionFees');
  return { ...actual, __esModule: true, default: { recommendedFees: () => Promise.resolve(new actual.NetworkTransactionFee(7, 5, 2)) } };
});
// Mutable so a test can hand the screen a scanned code the way the scanner does, or a link from home.
const mockRoute: { params: { isEditable: boolean; walletID: string; onBarScanned?: string; uri?: string } } = {
  params: { isEditable: true, walletID: 'wallet-1' },
};
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useRoute: () => mockRoute,
    // There's no navigator here, so the screen counts as focused once, on mount.
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const BALANCE = 100_000;
const ADDRESS = 'tb1qsendtestaddress';
const navigation = { setParams: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), navigate: jest.fn() };

const makeWallet = (preferredBalanceUnit: BitcoinUnit) => ({
  type: 'test',
  chain: Chain.ONCHAIN,
  preferredBalanceUnit,
  getPreferredBalanceUnit() {
    return this.preferredBalanceUnit;
  },
  allowSend: () => true,
  getID: () => 'wallet-1',
  getBalance: () => BALANCE,
  isAddressValid: (address: string) => address === ADDRESS,
  // the on-chain check above, plus the silent payment addresses the tests send to
  isPayableAddress: (address: string) => address === ADDRESS || [SP_MAINNET, SP_MAINNET_2].includes(address),
  getUtxo: () => [],
  fetchUtxo: () => Promise.resolve(),
  coinselect: jest.fn((_utxos: unknown, _targets: { address: string; value?: number }[]) => ({ fee: 810 })),
});

let wallet: ReturnType<typeof makeWallet>;
let saveToDisk: jest.Mock;

// A fresh element each time, so a rerender actually renders the screen again.
const tree = () => (
  <SafeAreaProvider>
    <NavigationContainer>
      <SendDetails />
    </NavigationContainer>
  </SafeAreaProvider>
);

const renderScreen = async () => {
  render(tree());
  // let the cached-fee read, the fee fetch and the UTXO refresh settle
  await act(async () => {});
};

// Hands the screen a code the way the scanner does. The screen clears it through setParams, a mock
// here, so clear it too: the next scan then lands even if it's the same code.
const scan = async (code: string) => {
  mockRoute.params.onBarScanned = code;
  screen.rerender(tree());
  await act(async () => {});
  delete mockRoute.params.onBarScanned;
  screen.rerender(tree());
};

const amount = () => screen.getByTestId('AmountHeroInput').props.value;
const address = () => screen.getByTestId('AddressInput').props.value;
const memoUpdates = () => navigation.setParams.mock.calls.filter(([params]) => params?.transactionMemo !== undefined);
const typeAmount = (text: string) => fireEvent.changeText(screen.getByTestId('AmountHeroInput'), text);
const unitSegment = (unit: BitcoinUnit) => screen.getByTestId(`AmountUnit-${unit}`);
const selectUnit = (unit: BitcoinUnit) => fireEvent.press(unitSegment(unit));
const unitLabel = () => screen.getByTestId('AmountHeroUnit');
const estimateOf = (sats: number) => screen.getByText(`≈ ${formatBalance(sats, BitcoinUnit.SATS, true)}`);

beforeAll(() => {
  _setSkipUpdateExchangeRate();
});

beforeEach(() => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  wallet = makeWallet(BitcoinUnit.SATS);
  saveToDisk = jest.fn();
  (useStorage as jest.Mock).mockReturnValue({ wallets: [wallet], sleep: () => Promise.resolve(), txMetadata: {}, saveToDisk });
  (useContacts as jest.Mock).mockReturnValue({
    contactList: [],
    getContact: () => undefined,
    saveContact: jest.fn(),
    validate: () => [],
  });
  (useExtendedNavigation as jest.Mock).mockReturnValue(navigation);
  delete mockRoute.params.onBarScanned;
  delete mockRoute.params.uri;
  _setPreferredFiatCurrency(FiatUnit.INR);
  _setExchangeRate('BTC_INR', 10_000_000);
});

describe('unit - SendDetails amount', () => {
  it('opens in the unit the rest of the app uses', async () => {
    await renderScreen();
    expect(unitLabel()).toHaveTextContent('sats');

    wallet.preferredBalanceUnit = BitcoinUnit.BTC;
    screen.unmount();
    await renderScreen();
    expect(unitLabel()).toHaveTextContent('BTC');
  });

  it('switches between sats, BTC and the local currency without changing the amount', async () => {
    await renderScreen();
    typeAmount('1234');
    expect(amount()).toBe('1234');

    selectUnit(BitcoinUnit.BTC);
    expect(unitLabel()).toHaveTextContent('BTC');
    expect(amount()).toBe('0.00001234');

    selectUnit(BitcoinUnit.LOCAL_CURRENCY);
    expect(unitLabel()).toHaveTextContent(getCurrencyCode());
    expect(amount()).toBe('123.40');
    expect(estimateOf(1234)).toBeTruthy();

    selectUnit(BitcoinUnit.SATS);
    expect(unitLabel()).toHaveTextContent('sats');
    expect(amount()).toBe('1234');
  });

  it('takes an amount typed in the local currency', async () => {
    await renderScreen();
    selectUnit(BitcoinUnit.LOCAL_CURRENCY);

    // a half-typed amount stays as typed
    typeAmount('0.');
    expect(amount()).toBe('0.');

    typeAmount('100');
    expect(amount()).toBe('100');
    expect(estimateOf(1000)).toBeTruthy();

    selectUnit(BitcoinUnit.SATS);
    expect(amount()).toBe('1000');

    // untouched in sats, so it comes back as typed
    selectUnit(BitcoinUnit.LOCAL_CURRENCY);
    expect(amount()).toBe('100');
  });

  it('shows Max in the local currency and clears it again', async () => {
    await renderScreen();
    selectUnit(BitcoinUnit.LOCAL_CURRENCY);
    typeAmount('0.');

    fireEvent.press(screen.getByTestId('UseMaxButton'));
    expect(amount()).toBe('10000');
    expect(estimateOf(BALANCE)).toBeTruthy();

    fireEvent.press(screen.getByTestId('UseMaxButton'));
    expect(amount()).toBe('');
  });

  it('restates an amount that arrives in a pasted payment link in the local currency', async () => {
    await renderScreen();
    selectUnit(BitcoinUnit.LOCAL_CURRENCY);
    typeAmount('5');

    fireEvent.changeText(screen.getByTestId('AddressInput'), `bitcoin:${ADDRESS}?amount=0.0001`);
    expect(amount()).toBe('1000');
    expect(estimateOf(10_000)).toBeTruthy();
  });

  it('drops a half-typed fiat amount once a scanned code brings its own', async () => {
    await renderScreen();
    selectUnit(BitcoinUnit.LOCAL_CURRENCY);
    typeAmount('0.');

    await scan(`bitcoin:${SP_MAINNET}?amount=0.0001`);
    expect(amount()).toBe('1000');
  });

  it('keeps the local currency in place, unavailable until a rate arrives', async () => {
    _setPreferredFiatCurrency(FiatUnit.EUR);
    await renderScreen();
    expect(unitSegment(BitcoinUnit.LOCAL_CURRENCY)).toBeDisabled();
    selectUnit(BitcoinUnit.LOCAL_CURRENCY);
    expect(unitLabel()).toHaveTextContent('sats');

    act(() => _setExchangeRate('BTC_EUR', 10_000_000));
    expect(unitSegment(BitcoinUnit.LOCAL_CURRENCY)).toBeEnabled();
    selectUnit(BitcoinUnit.LOCAL_CURRENCY);
    expect(unitLabel()).toHaveTextContent('EUR');
  });

  it("never writes the unit back to the wallet, so home keeps the app's unit", async () => {
    await renderScreen();
    typeAmount('1234');
    selectUnit(BitcoinUnit.BTC);
    selectUnit(BitcoinUnit.LOCAL_CURRENCY);
    selectUnit(BitcoinUnit.SATS);
    selectUnit(BitcoinUnit.BTC);
    expect(unitLabel()).toHaveTextContent('BTC');
    expect(wallet.preferredBalanceUnit).toBe(BitcoinUnit.SATS);
    expect(saveToDisk).not.toHaveBeenCalled();
  });
});

describe('unit - SendDetails payment requests', () => {
  it('fills in a scanned silent payment request', async () => {
    await renderScreen();
    await scan(`bitcoin:${SP_MAINNET}?amount=0.0001&label=Coffee`);

    expect(address()).toBe(SP_MAINNET);
    expect(amount()).toBe('10000');
    expect(memoUpdates()).toEqual([[{ transactionMemo: 'Coffee' }]]);
    expect(presentAlert).not.toHaveBeenCalled();
  });

  it('fills in a payment request opened from home', async () => {
    mockRoute.params.uri = `bitcoin:${SP_MAINNET}?amount=0.0001&label=Coffee`;
    await renderScreen();

    expect(address()).toBe(SP_MAINNET);
    expect(amount()).toBe('10000');
    expect(memoUpdates()).toEqual([[{ transactionMemo: 'Coffee' }]]);
  });

  it('keeps the amount and note typed in when a scanned request leaves them out', async () => {
    await renderScreen();
    typeAmount('1234');

    await scan(`bitcoin:${SP_MAINNET}?label=Shop`);
    expect(address()).toBe(SP_MAINNET);
    expect(amount()).toBe('1234');

    navigation.setParams.mockClear();
    await scan(`bitcoin:${SP_MAINNET_2}?amount=0.0001`);
    expect(address()).toBe(SP_MAINNET_2);
    expect(memoUpdates()).toEqual([]);
  });

  it('fills in the address of a request whose amount it cannot read', async () => {
    await renderScreen();
    await scan(`bitcoin:${SP_MAINNET}?amount[]=x&label=Coffee`);

    expect(address()).toBe(SP_MAINNET);
    expect(amount()).toBe('');
    expect(presentAlert).not.toHaveBeenCalled();
  });

  it('says why a scanned code cannot be paid, in the words home uses', async () => {
    await renderScreen();

    await scan('lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq');
    expect(presentAlert).toHaveBeenLastCalledWith({
      title: loc.errors.error,
      message: scanErrorMessage('unrecognized'),
      hapticFeedback: HapticFeedbackTypes.NotificationError,
    });

    await scan(`bitcoin:${SP_SIGNET}?amount=0.0001`);
    expect(presentAlert).toHaveBeenLastCalledWith({
      title: loc.errors.error,
      message: scanErrorMessage('wrong_network'),
      hapticFeedback: HapticFeedbackTypes.NotificationError,
    });
    expect(address()).toBe('');
  });

  it('estimates the fee for a silent payment recipient rather than a placeholder', async () => {
    await renderScreen();
    fireEvent.changeText(screen.getByTestId('AddressInput'), SP_MAINNET);
    typeAmount('1234');

    const [, targets] = wallet.coinselect.mock.lastCall!;
    expect(targets).toEqual([{ address: SP_MAINNET, value: 1234 }]);
  });
});
