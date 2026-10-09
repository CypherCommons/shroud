import assert from 'assert';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import OnboardingScreen from '../../screen/wallets/OnboardingScreen';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { getDefaultIndexer } from '../../modules/SilentPaymentIndexer';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/useExtendedNavigation');
jest.mock('../../modules/SilentPaymentIndexer');
jest.mock('../../modules/hapticFeedback');
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const renderScreen = () =>
  render(
    <NavigationContainer>
      <OnboardingScreen />
    </NavigationContainer>,
  );

describe('unit - OnboardingScreen create', () => {
  let navigate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    navigate = jest.fn();
    (useExtendedNavigation as jest.Mock).mockReturnValue({ navigate, navigateToWalletsList: jest.fn() });
    (getDefaultIndexer as jest.Mock).mockReturnValue({ getLatestBlockHeight: jest.fn().mockResolvedValue({ height: 900_000 }) });
  });

  it('reopens an unfinished draft instead of generating new words', async () => {
    const draft = HDSilentPaymentsWallet.fromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
    const setPendingWallet = jest.fn();
    (useStorage as jest.Mock).mockReturnValue({ wallets: [], getPendingWallet: () => draft, setPendingWallet });
    const generate = jest.spyOn(HDSilentPaymentsWallet.prototype, 'generate');

    fireEvent.press(renderScreen().getByTestId('CreateWallet'));

    await waitFor(() => assert.strictEqual(navigate.mock.calls.length, 1));
    assert.strictEqual(generate.mock.calls.length, 0);
    assert.strictEqual(setPendingWallet.mock.calls.length, 0);
    generate.mockRestore();
  });

  it('opens the backup screen only once the new draft is saved', async () => {
    let finishSave: () => void = () => {};
    const setPendingWallet = jest.fn(() => new Promise<void>(resolve => (finishSave = resolve)));
    (useStorage as jest.Mock).mockReturnValue({ wallets: [], getPendingWallet: () => null, setPendingWallet });

    fireEvent.press(renderScreen().getByTestId('CreateWallet'));

    await waitFor(() => assert.strictEqual(setPendingWallet.mock.calls.length, 1));
    assert.strictEqual(navigate.mock.calls.length, 0, 'the words must not be shown before the draft is saved');
    await act(async () => finishSave());
    await waitFor(() => assert.strictEqual(navigate.mock.calls.length, 1));
  });
});
