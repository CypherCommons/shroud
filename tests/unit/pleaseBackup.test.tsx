import assert from 'assert';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import PleaseBackup from '../../screen/wallets/PleaseBackup';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useSettings } from '../../hooks/context/useSettings';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import presentAlert from '../../components/Alert';
import loc from '../../loc';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/context/useSettings');
jest.mock('../../hooks/useExtendedNavigation');
jest.mock('../../hooks/useScreenProtect', () => ({
  useScreenProtect: () => ({ enableScreenProtect: jest.fn(), disableScreenProtect: jest.fn() }),
}));
// Starts on the seed step and exposes the 5-tap verification shortcut, as the e2e suite uses it.
jest.mock('../../helpers/e2e', () => ({ isE2E: () => true }));
jest.mock('@react-native-community/blur', () => ({ BlurView: () => null }));
jest.mock('../../components/Alert');
jest.mock('../../modules/hapticFeedback');
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
  };
});

const mockUseStorage = useStorage as jest.Mock;
const mockUseSettings = useSettings as jest.Mock;
const mockUseExtendedNavigation = useExtendedNavigation as jest.Mock;
const mockPresentAlert = presentAlert as jest.Mock;

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSPHRASE = 'correct horse';

// Continue yields once before moving on, so "it didn't move on" is only true after that.
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));

const renderScreen = () =>
  render(
    <NavigationContainer>
      <PleaseBackup />
    </NavigationContainer>,
  );

describe('unit - PleaseBackup passphrase', () => {
  let commitPendingWallet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    commitPendingWallet = jest.fn().mockResolvedValue(undefined);
    const pending = HDSilentPaymentsWallet.fromMnemonic(MNEMONIC);
    mockUseStorage.mockReturnValue({ getPendingWallet: () => pending, commitPendingWallet });
    mockUseSettings.mockReturnValue({ isScreenCaptureAllowed: true });
    mockUseExtendedNavigation.mockReturnValue({ navigateToWalletsList: jest.fn(), goBack: jest.fn() });
  });

  const fillPassphrase = (screen: ReturnType<typeof renderScreen>, { confirmation = PASSPHRASE, acknowledge = true } = {}) => {
    fireEvent.press(screen.getByTestId('ConfirmWrittenDown'));
    fireEvent.press(screen.getByTestId('AddPassphrase'));
    fireEvent.changeText(screen.getByTestId('NewPassphraseInput'), PASSPHRASE);
    fireEvent.changeText(screen.getByTestId('NewPassphraseConfirmInput'), confirmation);
    if (acknowledge) fireEvent.press(screen.getByTestId('NewPassphraseAcknowledge'));
  };

  const finishVerification = (screen: ReturnType<typeof renderScreen>) => {
    // hidden from accessibility on purpose, so it has to be looked up as a hidden element
    for (let i = 0; i < 5; i++) fireEvent.press(screen.getByTestId('SkipVerifyBackdoor', { includeHiddenElements: true }));
  };

  it('keeps Continue disabled until the passphrase is typed twice and acknowledged', async () => {
    const screen = renderScreen();
    fillPassphrase(screen, { confirmation: 'correct hors', acknowledge: false });

    fireEvent.press(screen.getByTestId('ContinueToVerify'));
    await settle();
    assert.ok(screen.queryByTestId('SeedVerificationBackButton') === null, 'an incomplete form must block Continue');

    fireEvent.press(screen.getByTestId('NewPassphraseAcknowledge'));
    fireEvent.press(screen.getByTestId('ContinueToVerify'));
    await settle();
    assert.ok(screen.queryByTestId('SeedVerificationBackButton') === null, 'mismatched confirmation must still block');

    fireEvent.changeText(screen.getByTestId('NewPassphraseConfirmInput'), PASSPHRASE);
    fireEvent.press(screen.getByTestId('ContinueToVerify'));
    await waitFor(() => screen.getByTestId('SeedVerificationBackButton'));
  });

  it('saves with the passphrase once verification is done', async () => {
    const screen = renderScreen();
    fillPassphrase(screen);
    fireEvent.press(screen.getByTestId('ContinueToVerify'));
    await waitFor(() => screen.getByTestId('SeedVerificationBackButton'));

    // the verification step names the wallet the passphrase opens
    const expected = HDSilentPaymentsWallet.fromMnemonic(MNEMONIC, PASSPHRASE).passphraseFingerprint!;
    assert.ok(screen.getByText(new RegExp(expected)));

    fireEvent.press(screen.getByTestId('SeedVerificationBackButton'));
    finishVerification(screen);

    await waitFor(() => assert.strictEqual(commitPendingWallet.mock.calls.length, 1));
    assert.strictEqual(commitPendingWallet.mock.calls[0][1], PASSPHRASE);
  });

  it('saves without a passphrase when it is unticked after going back', async () => {
    const screen = renderScreen();
    fillPassphrase(screen);
    fireEvent.press(screen.getByTestId('ContinueToVerify'));
    await waitFor(() => screen.getByTestId('SeedVerificationBackButton'));
    fireEvent.press(screen.getByTestId('SeedVerificationBackButton'));

    fireEvent.press(screen.getByTestId('AddPassphrase'));
    finishVerification(screen);

    await waitFor(() => assert.strictEqual(commitPendingWallet.mock.calls.length, 1));
    assert.strictEqual(commitPendingWallet.mock.calls[0][1], undefined);
  });

  it('does not apply a passphrase that was never confirmed with Continue', async () => {
    const screen = renderScreen();
    fillPassphrase(screen);
    finishVerification(screen);

    await waitFor(() => assert.strictEqual(commitPendingWallet.mock.calls.length, 1));
    assert.strictEqual(commitPendingWallet.mock.calls[0][1], undefined);
  });

  it('saves without a passphrase on Skip Anyway', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('RevealBackButton'));
    fireEvent.press(screen.getByTestId('BackupIntroBackButton'));

    const { buttons } = mockPresentAlert.mock.calls[0][0];
    buttons.find((b: { style?: string }) => b.style === 'destructive').onPress();

    await waitFor(() => assert.strictEqual(commitPendingWallet.mock.calls.length, 1));
    assert.strictEqual(commitPendingWallet.mock.calls[0][1], undefined);
  });

  it('warns on Skip Anyway that a passphrase never continued with won’t be added', () => {
    const screen = renderScreen();
    fillPassphrase(screen);
    fireEvent.press(screen.getByTestId('RevealBackButton'));
    fireEvent.press(screen.getByTestId('BackupIntroBackButton'));

    assert.ok(mockPresentAlert.mock.calls[0][0].message.includes(loc.passphrase.skip_not_added));
  });

  // The real navigation object is rebuilt whenever the wallet list changes, which committing does.
  it('saves only once when the screen re-renders after saving', async () => {
    mockUseExtendedNavigation.mockImplementation(() => ({ navigateToWalletsList: jest.fn(), goBack: jest.fn() }));
    const screen = renderScreen();
    finishVerification(screen);
    await waitFor(() => assert.strictEqual(commitPendingWallet.mock.calls.length, 1));

    screen.rerender(
      <NavigationContainer>
        <PleaseBackup />
      </NavigationContainer>,
    );

    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(commitPendingWallet.mock.calls.length, 1);
    assert.strictEqual(mockPresentAlert.mock.calls.length, 0);
  });

  it('leaves, once, when opened with nothing to back up', async () => {
    const goBack = jest.fn();
    mockUseStorage.mockReturnValue({ getPendingWallet: () => null, commitPendingWallet });
    mockUseExtendedNavigation.mockImplementation(() => ({ navigateToWalletsList: jest.fn(), goBack }));
    const screen = renderScreen();
    screen.rerender(
      <NavigationContainer>
        <PleaseBackup />
      </NavigationContainer>,
    );

    await waitFor(() => assert.strictEqual(goBack.mock.calls.length, 1));
    assert.ok(screen.queryByTestId('ContinueToVerify') === null);
  });
});
