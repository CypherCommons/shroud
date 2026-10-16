import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { isUpdateGateEnabled } from '../../helpers/e2e';
import { useUpdateRequired } from '../../hooks/useUpdateRequired';
import { fetch } from '../../util/fetch';

jest.mock('../../util/fetch');
jest.mock('../../helpers/e2e', () => ({ isUpdateGateEnabled: jest.fn(() => true) }));
jest.mock('expo-updates', () => ({ channel: 'preview' }));

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
const mockGateEnabled = isUpdateGateEnabled as jest.MockedFunction<typeof isUpdateGateEnabled>;
const mockUpdates = jest.requireMock('expo-updates') as { channel: string | null };
const respond = (status: number, body?: unknown) => ({ status, json: async () => body }) as unknown as Response;

// tests/setup.js reports build 1, and Platform.OS is ios.
const blockingPolicy = { minimumBuild: { ios: 2 } };

describe('unit - useUpdateRequired', () => {
  beforeEach(async () => {
    mockUpdates.channel = 'preview';
    mockGateEnabled.mockReturnValue(true);
    mockFetch.mockReset();
    await AsyncStorage.clear();
  });

  it('is off in development and under Detox: no verdict to wait for and no request', async () => {
    mockGateEnabled.mockReturnValue(false);
    await AsyncStorage.setItem('UpdatePolicy', JSON.stringify(blockingPolicy));
    const { result } = renderHook(() => useUpdateRequired());

    expect(result.current).toBe(false);
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('holds a saved block before the server answers, then follows the answer', async () => {
    await AsyncStorage.setItem('UpdatePolicy', JSON.stringify(blockingPolicy));
    let answer: (response: Response) => void = () => {};
    mockFetch.mockReturnValue(new Promise(resolve => (answer = resolve)));
    const { result } = renderHook(() => useUpdateRequired());

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), { headers: { 'expo-channel-name': 'preview' } });

    await act(async () => answer(respond(204)));
    expect(result.current).toBe(false);
  });

  it('blocks when the server sets a minimum above this build', async () => {
    mockFetch.mockResolvedValue(respond(200, { minimumBuild: { ios: 2, android: 9 } }));
    const { result } = renderHook(() => useUpdateRequired());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('asks for production when the build names no channel', async () => {
    mockUpdates.channel = '';
    mockFetch.mockResolvedValue(respond(204));
    const { result } = renderHook(() => useUpdateRequired());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(expect.any(String), { headers: { 'expo-channel-name': 'production' } }));
    expect(result.current).toBe(false);
  });
});
