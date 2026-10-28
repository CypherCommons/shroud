import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import OnboardingScreen from '../../screen/wallets/OnboardingScreen';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { getDefaultIndexer } from '../../modules/SilentPaymentIndexer';
import { BIP352_ACTIVATION_HEIGHT } from '../../modules/constants';
import { setActiveNetwork } from '../../modules/network';
import presentAlert from '../../components/Alert';
import loc from '../../loc';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/useExtendedNavigation');
jest.mock('../../modules/SilentPaymentIndexer');
jest.mock('../../components/Alert');
jest.mock('../../modules/hapticFeedback');
// A host view standing in for the native menu, so a test can pick an item by calling onPressAction.
jest.mock('@react-native-menu/menu', () => {
  const { View } = jest.requireActual('react-native');
  return { MenuView: (props: object) => <View testID="MenuView" {...props} /> };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

const mockUseStorage = useStorage as jest.Mock;
const mockUseExtendedNavigation = useExtendedNavigation as jest.Mock;
const mockGetDefaultIndexer = getDefaultIndexer as jest.Mock;
const mockPresentAlert = presentAlert as jest.Mock;

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TIP = 900000;

const signetWallet = (): HDSilentPaymentsWallet => {
  setActiveNetwork('signet');
  const wallet = HDSilentPaymentsWallet.fromMnemonic(MNEMONIC, 'extra words');
  wallet.setLabel('Everyday');
  wallet.setUserHasSavedExport(true);
  setActiveNetwork('bitcoin');
  return wallet;
};

const renderScreen = () =>
  render(
    <NavigationContainer>
      <OnboardingScreen />
    </NavigationContainer>,
  );

describe('unit - Onboarding', () => {
  let addWallet: jest.Mock;
  let deleteWallet: jest.Mock;
  let saveToDisk: jest.Mock;
  let switchNetwork: jest.Mock;
  let navigateToWalletsList: jest.Mock;
  let getLatestBlockHeight: jest.Mock;

  const mockStorage = (walletToReuse?: HDSilentPaymentsWallet) =>
    mockUseStorage.mockReturnValue({
      wallets: [],
      addWallet,
      deleteWallet,
      saveToDisk,
      activeNetworkId: 'bitcoin',
      isSwitchingNetwork: false,
      switchNetwork,
      walletToReuse,
    });

  // Taps the reuse button and answers the dialog it opens.
  const reuseWith = async (answer: string) => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc.formatString(loc.onboarding.reuse_phrase, { from: 'Signet' })));
    const [{ title, message, buttons }] = mockPresentAlert.mock.calls[0];
    expect(title).toBe(loc.formatString(loc.onboarding.reuse_phrase_title, { from: 'Signet' }));
    expect(message).toBe(loc.formatString(loc.onboarding.reuse_phrase_message, { to: 'Mainnet' }));
    await act(async () => buttons.find((b: { text: string }) => b.text === answer).onPress());
  };

  const addedWallet = () => addWallet.mock.calls[0][0] as HDSilentPaymentsWallet;

  beforeEach(() => {
    jest.clearAllMocks();
    addWallet = jest.fn().mockReturnValue(true);
    deleteWallet = jest.fn();
    saveToDisk = jest.fn().mockResolvedValue(undefined);
    switchNetwork = jest.fn().mockResolvedValue(undefined);
    navigateToWalletsList = jest.fn();
    getLatestBlockHeight = jest.fn().mockResolvedValue({ height: TIP });
    mockUseExtendedNavigation.mockReturnValue({ navigate: jest.fn(), navigateToWalletsList });
    mockGetDefaultIndexer.mockReturnValue({ getLatestBlockHeight });
  });

  afterEach(() => setActiveNetwork('bitcoin'));

  describe('network picker', () => {
    it('lists the selectable chains with the active one checked', () => {
      mockStorage();
      const screen = renderScreen();
      const actions = screen.getByTestId('MenuView').props.actions;
      expect(actions.map((a: { title: string }) => a.title)).toEqual(['Mainnet', 'Signet']);
      expect(actions.map((a: { state: string }) => a.state)).toEqual(['on', 'off']);
    });

    it('switches to the chain picked from it', async () => {
      mockStorage();
      const screen = renderScreen();
      await act(async () => screen.getByTestId('MenuView').props.onPressAction({ nativeEvent: { event: 'signet' } }));
      expect(switchNetwork).toHaveBeenCalledWith('signet');
    });
  });

  describe('reusing a recovery phrase from another chain', () => {
    it('is not offered when no other chain has a wallet', () => {
      mockStorage(undefined);
      const screen = renderScreen();
      expect(screen.queryByTestId('ReuseRecoveryPhrase')).toBeNull();
    });

    it('sets up this chain from the same phrase and passphrase, scanning from now', async () => {
      const source = signetWallet();
      mockStorage(source);

      await reuseWith(loc.onboarding.reuse_phrase_start_now);
      await waitFor(() => expect(navigateToWalletsList).toHaveBeenCalled());

      const wallet = addedWallet();
      expect(wallet.networkId).toBe('bitcoin');
      expect(wallet.getSecret()).toBe(source.getSecret());
      expect(wallet.getPassphrase()).toBe('extra words');
      expect(wallet.getID()).not.toBe(source.getID());
      expect(wallet.getLabel()).toBe('Everyday');
      expect(wallet.getUserHasSavedExport()).toBe(true);
      expect(wallet.getEffectiveBirthHeight()).toBe(TIP);
      expect(saveToDisk).toHaveBeenCalled();
    });

    it('scans the whole chain when the phrase may have been paid there before', async () => {
      mockStorage(signetWallet());

      await reuseWith(loc.onboarding.reuse_phrase_scan_history);
      await waitFor(() => expect(navigateToWalletsList).toHaveBeenCalled());

      expect(addedWallet().getEffectiveBirthHeight()).toBe(BIP352_ACTIVATION_HEIGHT);
      expect(getLatestBlockHeight).not.toHaveBeenCalled();
    });

    it('stops at the single-wallet limit without saving', async () => {
      addWallet.mockReturnValue(false);
      mockStorage(signetWallet());

      await reuseWith(loc.onboarding.reuse_phrase_start_now);

      expect(mockPresentAlert).toHaveBeenLastCalledWith({ message: loc.wallets.single_wallet_limit });
      expect(saveToDisk).not.toHaveBeenCalled();
      expect(navigateToWalletsList).not.toHaveBeenCalled();
    });

    it('takes the wallet back out when it cannot be saved', async () => {
      saveToDisk.mockRejectedValue(new Error('disk full'));
      mockStorage(signetWallet());

      await reuseWith(loc.onboarding.reuse_phrase_start_now);

      expect(deleteWallet).toHaveBeenCalledWith(addedWallet());
      expect(mockPresentAlert).toHaveBeenLastCalledWith(expect.objectContaining({ title: loc.errors.error, message: 'disk full' }));
      expect(navigateToWalletsList).not.toHaveBeenCalled();
    });
  });
});
