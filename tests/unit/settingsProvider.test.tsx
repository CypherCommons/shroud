import assert from 'assert';
import React from 'react';
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
  beforeEach(async () => {
    mockUseStorage.mockReturnValue({ walletsInitialized: true });
    await DefaultPreference.clearAll();
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

  it('falls back themePreference to system when a stale/invalid value is persisted', async () => {
    await DefaultPreference.setName('group.com.shroudwallet.app');
    await DefaultPreference.set('ThemePreference', 'not-a-real-theme');

    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => assert.strictEqual(result.current.settingsLoaded, true));

    assert.strictEqual(result.current.themePreference, 'system');
  });
});
