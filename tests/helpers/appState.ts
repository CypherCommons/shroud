import { AppState, AppStateStatus } from 'react-native';
import { act } from '@testing-library/react-native';

/**
 * Routes AppState's 'change' listeners to the test, which can then send the app to the background and back.
 * Call in a beforeEach: it starts each test with no listeners.
 */
export const fakeAppState = () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  (AppState.addEventListener as jest.Mock).mockImplementation((_type: string, listener: (state: AppStateStatus) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  return { setAppState: (state: AppStateStatus) => act(() => listeners.forEach(listener => listener(state))) };
};
