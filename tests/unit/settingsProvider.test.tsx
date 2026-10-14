import assert from 'assert';
import React from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import DefaultPreference from 'react-native-default-preference';

import { SettingsProvider } from '../../components/Context/SettingsProvider';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../modules/Electrum', () => ({
  isDisabled: jest.fn().mockResolvedValue(false),
  forceDisconnect: jest.fn(),
  connectMain: jest.fn(),
}));
jest.mock('../../modules/clipboard', () => ({
  isReadClipboardAllowed: jest.fn().mockResolvedValue(true),
  setReadClipboardAllowed: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../modules/currency', () => ({
  GROUP_IO_SHROUD: 'group.com.shroudwallet.app',
  initCurrencyDaemon: jest.fn().mockResolvedValue(undefined),
  getPreferredCurrency: jest.fn().mockResolvedValue('USD'),
  setPreferredCurrency: jest.fn().mockResolvedValue(undefined),
}));

const mockUseStorage = useStorage as jest.Mock;

const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;

describe('unit - SettingsProvider', () => {
  // This test's live AppState listeners, so it can send the app to the background.
  let appStateListeners: Set<(state: AppStateStatus) => void>;
  const setAppState = (state: AppStateStatus) => act(() => appStateListeners.forEach(listener => listener(state)));

  beforeEach(async () => {
    mockUseStorage.mockReturnValue({ walletsInitialized: true });
    await DefaultPreference.clearAll();
    appStateListeners = new Set();
    (AppState.addEventListener as jest.Mock).mockImplementation((_type: string, listener: (state: AppStateStatus) => void) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    });
  });

  it('defaults themePreference to system and persists a change across a remount', async () => {
    const { result, unmount } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(result.current.settingsLoaded, true));

    assert.strictEqual(result.current.themePreference, 'system');

    await act(async () => {
      await result.current.setThemePreferenceStorage('dark');
    });
    assert.strictEqual(result.current.themePreference, 'dark');
    unmount();

    const { result: remounted } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(remounted.current.settingsLoaded, true));

    assert.strictEqual(remounted.current.themePreference, 'dark');
  });

  it('crash reports switch writes the flag that native code reads at launch', async () => {
    const { result, unmount } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(result.current.settingsLoaded, true));
    assert.strictEqual(result.current.isDoNotTrackEnabled, false);

    await act(async () => {
      await result.current.setIsDoNotTrackEnabledStorage(true);
    });
    assert.strictEqual(result.current.isDoNotTrackEnabled, true);
    // MainApplication.kt and AppDelegate.swift read 'donottrack' from this group and skip Bugsnag on '1'.
    await DefaultPreference.setName('group.com.shroudwallet.app');
    assert.strictEqual(await DefaultPreference.get('donottrack'), '1');
    unmount();

    const { result: remounted } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(remounted.current.settingsLoaded, true));
    assert.strictEqual(remounted.current.isDoNotTrackEnabled, true);

    await act(async () => {
      await remounted.current.setIsDoNotTrackEnabledStorage(false);
    });
    await DefaultPreference.setName('group.com.shroudwallet.app');
    assert.strictEqual(await DefaultPreference.get('donottrack'), null);
  });

  it('keeps hide balance on when the eye shows the amounts, so the next launch starts hidden', async () => {
    const { result, unmount } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(result.current.settingsLoaded, true));
    assert.strictEqual(result.current.isHideBalanceEnabled, false);
    assert.strictEqual(result.current.isBalanceHidden, false);

    await act(async () => {
      await result.current.setIsHideBalanceEnabledStorage(true);
    });
    assert.strictEqual(result.current.isBalanceHidden, true);

    act(() => result.current.toggleBalanceHidden());
    assert.strictEqual(result.current.isBalanceHidden, false);
    assert.strictEqual(result.current.isHideBalanceEnabled, true);
    unmount();

    const { result: remounted } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(remounted.current.settingsLoaded, true));
    assert.strictEqual(remounted.current.isHideBalanceEnabled, true);
    assert.strictEqual(remounted.current.isBalanceHidden, true);
  });

  it('lets a change to hide balance take over from the eye', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(result.current.settingsLoaded, true));
    await act(async () => {
      await result.current.setIsHideBalanceEnabledStorage(true);
    });
    act(() => result.current.toggleBalanceHidden());
    assert.strictEqual(result.current.isBalanceHidden, false);

    await act(async () => {
      await result.current.setIsHideBalanceEnabledStorage(false);
    });
    await act(async () => {
      await result.current.setIsHideBalanceEnabledStorage(true);
    });
    assert.strictEqual(result.current.isBalanceHidden, true);
  });

  it("ends the eye's choice when the app goes to the background, with hide balance on or off", async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(result.current.settingsLoaded, true));

    // Off: the eye hides the amounts, and a prompt or Control Center (inactive) leaves them hidden.
    act(() => result.current.toggleBalanceHidden());
    assert.strictEqual(result.current.isBalanceHidden, true);
    setAppState('inactive');
    assert.strictEqual(result.current.isBalanceHidden, true);
    setAppState('background');
    assert.strictEqual(result.current.isBalanceHidden, false);

    // On: the eye shows them.
    await act(async () => {
      await result.current.setIsHideBalanceEnabledStorage(true);
    });
    act(() => result.current.toggleBalanceHidden());
    assert.strictEqual(result.current.isBalanceHidden, false);
    setAppState('inactive');
    assert.strictEqual(result.current.isBalanceHidden, false);
    setAppState('background');
    assert.strictEqual(result.current.isBalanceHidden, true);
  });

  it('falls back themePreference to system when a stale/invalid value is persisted', async () => {
    await DefaultPreference.setName('group.com.shroudwallet.app');
    await DefaultPreference.set('ThemePreference', 'not-a-real-theme');

    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(result.current.settingsLoaded, true));

    assert.strictEqual(result.current.themePreference, 'system');
  });
});
