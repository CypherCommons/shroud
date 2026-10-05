import assert from 'assert';
import { renderHook } from '@testing-library/react-native';

import { useDeleteWallet } from '../../hooks/useDeleteWallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useProtectedAction } from '../../hooks/useProtectedAction';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import presentAlert from '../../components/Alert';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/useProtectedAction');
jest.mock('../../hooks/useExtendedNavigation');
jest.mock('../../components/Alert');

const mockUseStorage = useStorage as jest.Mock;
const mockUseProtectedAction = useProtectedAction as jest.Mock;
const mockUseExtendedNavigation = useExtendedNavigation as jest.Mock;
const mockPresentAlert = presentAlert as jest.Mock;

describe('unit - useDeleteWallet', () => {
  const wallet = { getID: () => 'wallet-id' };
  let handleWalletDeletion: jest.Mock;
  let runProtected: jest.Mock;
  let dispatch: jest.Mock;

  beforeEach(() => {
    handleWalletDeletion = jest.fn().mockResolvedValue(true);
    // Grants by default; tests that deny override it.
    runProtected = jest.fn(async (onGranted: () => Promise<void>) => onGranted());
    dispatch = jest.fn();

    mockUseStorage.mockReturnValue({ wallets: [wallet], handleWalletDeletion });
    mockUseProtectedAction.mockReturnValue({ runProtected, isPinPromptVisible: false, pinAttempt: {} });
    mockUseExtendedNavigation.mockReturnValue({ dispatch });
    mockPresentAlert.mockReset();
  });

  const getButtons = () => {
    const { result } = renderHook(() => useDeleteWallet());
    result.current.deleteWallet();

    const { buttons } = mockPresentAlert.mock.calls[0][0];
    return { buttons, destructive: buttons.find((b: any) => b.style === 'destructive') };
  };

  it('cancel button has no handler, so cancelling deletes nothing', () => {
    const { buttons } = getButtons();
    const cancel = buttons.find((b: any) => b.style === 'cancel');

    assert.strictEqual(cancel.onPress, undefined);
    assert.strictEqual(runProtected.mock.calls.length, 0);
    assert.strictEqual(handleWalletDeletion.mock.calls.length, 0);
  });

  it('does not delete when the biometrics/PIN check is not passed', async () => {
    runProtected.mockImplementation(async () => {});

    const { destructive } = getButtons();
    await destructive.onPress();

    assert.strictEqual(runProtected.mock.calls.length, 1);
    assert.strictEqual(handleWalletDeletion.mock.calls.length, 0);
    assert.strictEqual(dispatch.mock.calls.length, 0);
  });

  it('deletes and resets navigation once the check passes', async () => {
    const { destructive } = getButtons();
    await destructive.onPress();

    assert.strictEqual(handleWalletDeletion.mock.calls[0][0], 'wallet-id');
    assert.strictEqual(dispatch.mock.calls.length, 1);
    assert.deepStrictEqual(dispatch.mock.calls[0][0], {
      type: 'RESET',
      payload: { index: 0, routes: [{ name: 'Onboarding' }] },
    });
  });

  it('does not reset navigation when wallet deletion fails', async () => {
    handleWalletDeletion.mockResolvedValue(false);

    const { destructive } = getButtons();
    await destructive.onPress();

    assert.strictEqual(handleWalletDeletion.mock.calls.length, 1);
    assert.strictEqual(dispatch.mock.calls.length, 0);
  });

  it('exposes the PIN prompt state for the screen to render', () => {
    mockUseProtectedAction.mockReturnValue({ runProtected, isPinPromptVisible: true, pinAttempt: { id: 'p' } });

    const { result } = renderHook(() => useDeleteWallet());

    assert.strictEqual(result.current.isPinPromptVisible, true);
    assert.deepStrictEqual(result.current.pinAttempt, { id: 'p' });
  });
});
