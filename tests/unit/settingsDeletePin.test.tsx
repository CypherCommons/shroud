import React from 'react';
import { NavigationContainer, usePreventRemove } from '@react-navigation/native';
import { render, screen, waitFor } from '@testing-library/react-native';

import Settings from '../../screen/settings/Settings';
import { useDeleteWallet } from '../../hooks/useDeleteWallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useSettings } from '../../hooks/context/useSettings';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { getPinLockout } from '../../helpers/pinLock';
import loc from '../../loc';

jest.mock('../../hooks/useDeleteWallet');
jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/context/useSettings');
jest.mock('../../hooks/useExtendedNavigation');
jest.mock('../../helpers/pinLock', () => ({ getPinLockout: jest.fn(), attemptPin: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  usePreventRemove: jest.fn(),
}));

const mockUseDeleteWallet = useDeleteWallet as jest.Mock;
const mockUsePreventRemove = usePreventRemove as jest.Mock;
const mockGetPinLockout = getPinLockout as jest.Mock;

describe('unit - Settings delete-wallet PIN prompt', () => {
  const cancelPinPrompt = jest.fn();

  const renderSettings = (isPinPromptVisible: boolean) => {
    mockUseDeleteWallet.mockReturnValue({ deleteWallet: jest.fn(), isPinPromptVisible, cancelPinPrompt, onPinCorrect: jest.fn() });
    render(
      <NavigationContainer>
        <Settings />
      </NavigationContainer>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useStorage as jest.Mock).mockReturnValue({ wallets: [{}] });
    (useSettings as jest.Mock).mockReturnValue({ isPinLayoutScrambled: false });
    (useExtendedNavigation as jest.Mock).mockReturnValue({ navigate: jest.fn() });
    mockGetPinLockout.mockResolvedValue({ retryInMs: null, canOfferReset: false });
  });

  it('shows the settings list and reads no PIN state until the delete asks for the PIN', () => {
    renderSettings(false);

    expect(screen.getByTestId('DeleteWalletButton')).toBeTruthy();
    expect(screen.queryByText(loc.wallets.details_delete_pin_subtitle)).toBeNull();
    expect(mockGetPinLockout).not.toHaveBeenCalled();
    expect(mockUsePreventRemove).toHaveBeenLastCalledWith(false, cancelPinPrompt);
  });

  it('swaps in the PIN prompt, and back cancels the delete instead of leaving Settings', async () => {
    renderSettings(true);
    await waitFor(() => expect(mockGetPinLockout).toHaveBeenCalledTimes(1));

    expect(screen.getByText(loc.wallets.details_delete_pin_subtitle)).toBeTruthy();
    expect(screen.queryByTestId('DeleteWalletButton')).toBeNull();
    expect(mockUsePreventRemove).toHaveBeenLastCalledWith(true, cancelPinPrompt);
  });
});
