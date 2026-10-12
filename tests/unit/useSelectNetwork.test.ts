import { act, renderHook } from '@testing-library/react-native';

import { useSelectNetwork } from '../../hooks/useSelectNetwork';
import { useStorage } from '../../hooks/context/useStorage';
import confirm from '../../helpers/confirm';
import presentAlert from '../../components/Alert';
import loc from '../../loc';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../helpers/confirm');
jest.mock('../../components/Alert');

const mockUseStorage = useStorage as jest.Mock;
const mockConfirm = confirm as jest.Mock;
const mockPresentAlert = presentAlert as jest.Mock;

describe('unit - useSelectNetwork', () => {
  let switchNetwork: jest.Mock;

  const select = async (next: 'bitcoin' | 'signet', storage: object = {}) => {
    mockUseStorage.mockReturnValue({
      activeNetworkId: 'bitcoin',
      isSwitchingNetwork: false,
      scanState: { status: 'idle' },
      switchNetwork,
      ...storage,
    });
    const { result } = renderHook(() => useSelectNetwork());
    await act(() => result.current(next));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    switchNetwork = jest.fn().mockResolvedValue(undefined);
  });

  it('switches to another chain', async () => {
    await select('signet');
    expect(switchNetwork).toHaveBeenCalledWith('signet');
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('does nothing for the chain already active, or while a switch is under way', async () => {
    await select('bitcoin');
    await select('signet', { isSwitchingNetwork: true });
    expect(switchNetwork).not.toHaveBeenCalled();
  });

  it('asks before abandoning a running scan, and stays put if told no', async () => {
    mockConfirm.mockResolvedValue(false);
    await select('signet', { scanState: { status: 'scanning' } });
    expect(mockConfirm).toHaveBeenCalledWith(loc.settings.network_switch_scan_title, loc.settings.network_switch_scan_message);
    expect(switchNetwork).not.toHaveBeenCalled();
  });

  it('switches once the user agrees to abandon the scan', async () => {
    mockConfirm.mockResolvedValue(true);
    await select('signet', { scanState: { status: 'scanning' } });
    expect(switchNetwork).toHaveBeenCalledWith('signet');
  });

  it('reports a failed switch instead of throwing', async () => {
    switchNetwork.mockRejectedValue(new Error('Signet is currently disabled.'));
    await select('signet');
    expect(mockPresentAlert).toHaveBeenCalledWith({ title: loc.errors.error, message: 'Signet is currently disabled.' });
  });
});
