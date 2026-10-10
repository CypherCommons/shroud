import assert from 'assert';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import PassphraseUnlock from '../../screen/wallets/PassphraseUnlock';
import { useStorage } from '../../hooks/context/useStorage';
import { useSettings } from '../../hooks/context/useSettings';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import presentAlert from '../../components/Alert';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/context/useSettings');
jest.mock('../../hooks/useExtendedNavigation');
jest.mock('../../hooks/useBiometrics', () => ({ useBiometrics: jest.fn(), unlockWithBiometrics: jest.fn() }));
jest.mock('../../hooks/useScreenProtect', () => ({
  useScreenProtect: () => ({ enableScreenProtect: jest.fn(), disableScreenProtect: jest.fn() }),
}));
jest.mock('../../components/Alert');
jest.mock('../../modules/hapticFeedback');
jest.mock('../../NavigationService', () => ({ navigationRef: { current: { reset: jest.fn() } } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
}));

const mockPresentAlert = presentAlert as jest.Mock;
const mockUnlockWithBiometrics = unlockWithBiometrics as jest.Mock;

const renderScreen = () =>
  render(
    <NavigationContainer>
      <PassphraseUnlock />
    </NavigationContainer>,
  );

describe('unit - PassphraseUnlock forgot passphrase', () => {
  let forgetLockedWallet: jest.Mock;

  const confirmForget = async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('ForgotPassphrase'));
    const { buttons } = mockPresentAlert.mock.calls[0][0];
    await buttons.find((b: { style?: string }) => b.style === 'destructive').onPress();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    forgetLockedWallet = jest.fn().mockResolvedValue(undefined);
    (useStorage as jest.Mock).mockReturnValue({ unlockWallet: jest.fn(), forgetLockedWallet });
    (useSettings as jest.Mock).mockReturnValue({ isScreenCaptureAllowed: true });
    (useExtendedNavigation as jest.Mock).mockReturnValue({ navigate: jest.fn() });
  });

  it('removes nothing when biometrics are on and fail', async () => {
    (useBiometrics as jest.Mock).mockReturnValue({ isBiometricUseCapableAndEnabled: jest.fn().mockResolvedValue(true) });
    mockUnlockWithBiometrics.mockResolvedValue(false);

    await confirmForget();

    assert.strictEqual(mockUnlockWithBiometrics.mock.calls.length, 1);
    assert.strictEqual(forgetLockedWallet.mock.calls.length, 0);
  });

  it('removes the wallet once biometrics pass', async () => {
    (useBiometrics as jest.Mock).mockReturnValue({ isBiometricUseCapableAndEnabled: jest.fn().mockResolvedValue(true) });
    mockUnlockWithBiometrics.mockResolvedValue(true);

    await confirmForget();

    await waitFor(() => assert.strictEqual(forgetLockedWallet.mock.calls.length, 1));
  });

  it('removes the wallet without a prompt when biometrics are off', async () => {
    (useBiometrics as jest.Mock).mockReturnValue({ isBiometricUseCapableAndEnabled: jest.fn().mockResolvedValue(false) });

    await confirmForget();

    assert.strictEqual(mockUnlockWithBiometrics.mock.calls.length, 0);
    await waitFor(() => assert.strictEqual(forgetLockedWallet.mock.calls.length, 1));
  });
});
