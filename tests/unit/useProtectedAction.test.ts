import { act, renderHook } from '@testing-library/react-native';

import { useProtectedAction } from '../../hooks/useProtectedAction';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import { hasPinSet } from '../../helpers/pinLock';

jest.mock('../../hooks/useBiometrics', () => ({ useBiometrics: jest.fn(), unlockWithBiometrics: jest.fn() }));
jest.mock('../../helpers/pinLock', () => ({ hasPinSet: jest.fn() }));

const mockUseBiometrics = useBiometrics as jest.Mock;
const mockUnlockWithBiometrics = unlockWithBiometrics as jest.Mock;
const mockHasPinSet = hasPinSet as jest.Mock;

describe('unit - useProtectedAction', () => {
  let biometricsOn: boolean;
  const run = async (onGranted: jest.Mock, onDenied?: jest.Mock) => {
    const hook = renderHook(() => useProtectedAction());
    await act(() => hook.result.current.runProtected(onGranted, onDenied));
    return hook;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    biometricsOn = false;
    mockUseBiometrics.mockReturnValue({ isBiometricUseCapableAndEnabled: async () => biometricsOn });
    mockHasPinSet.mockResolvedValue(false);
  });

  it('uses biometrics when they are on, and never asks for the PIN', async () => {
    biometricsOn = true;
    mockHasPinSet.mockResolvedValue(true);
    mockUnlockWithBiometrics.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const onGranted = jest.fn();
    const onDenied = jest.fn();

    const { result } = await run(onGranted, onDenied);
    await act(() => result.current.runProtected(onGranted, onDenied));

    expect(onGranted).toHaveBeenCalledTimes(1);
    expect(onDenied).toHaveBeenCalledTimes(1);
    expect(result.current.isPinPromptVisible).toBe(false);
  });

  it('asks for the PIN when one is set and biometrics are off, and runs only after the right PIN', async () => {
    mockHasPinSet.mockResolvedValue(true);
    const onGranted = jest.fn();

    const { result } = await run(onGranted);
    expect(result.current.isPinPromptVisible).toBe(true);
    expect(onGranted).not.toHaveBeenCalled();

    act(() => result.current.onPinCorrect());
    expect(onGranted).toHaveBeenCalledTimes(1);
    expect(result.current.isPinPromptVisible).toBe(false);
  });

  it('asks for the PIN when it cannot tell whether one is set', async () => {
    mockHasPinSet.mockRejectedValue(new Error('keychain unavailable'));
    const onGranted = jest.fn();

    const { result } = await run(onGranted);

    expect(result.current.isPinPromptVisible).toBe(true);
    expect(onGranted).not.toHaveBeenCalled();
  });

  it('runs straight away with no biometrics and no PIN', async () => {
    const onGranted = jest.fn();

    const { result } = await run(onGranted);

    expect(onGranted).toHaveBeenCalledTimes(1);
    expect(result.current.isPinPromptVisible).toBe(false);
  });

  it('drops the action when the PIN prompt is cancelled', async () => {
    mockHasPinSet.mockResolvedValue(true);
    const onGranted = jest.fn();

    const { result } = await run(onGranted);
    act(() => result.current.cancelPinPrompt());
    act(() => result.current.onPinCorrect());

    expect(result.current.isPinPromptVisible).toBe(false);
    expect(onGranted).not.toHaveBeenCalled();
  });
});
