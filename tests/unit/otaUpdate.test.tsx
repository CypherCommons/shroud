import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, renderHook } from '@testing-library/react-native';

import { ShroudDefaultTheme } from '../../components/themes';
import { isUpdateGateEnabled } from '../../helpers/e2e';
import { deriveOtaScreen, lastFileProgress, SLOW_DOWNLOAD_MS, UpdatesSnapshot, useOtaUpdate } from '../../hooks/useOtaUpdate';

jest.mock('../../helpers/e2e', () => ({ isUpdateGateEnabled: jest.fn(() => true) }));
jest.mock('expo-updates', () => ({
  isEnabled: true,
  useUpdates: jest.fn(),
  reloadAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  UpdateInfoType: { NEW: 'new', ROLLBACK: 'rollback' },
}));

const mockUpdates = jest.requireMock('expo-updates') as {
  isEnabled: boolean;
  useUpdates: jest.Mock;
  reloadAsync: jest.Mock;
  fetchUpdateAsync: jest.Mock;
};
const mockGateEnabled = isUpdateGateEnabled as jest.MockedFunction<typeof isUpdateGateEnabled>;

const running = {
  isEmbeddedLaunch: true,
  isEmergencyLaunch: false,
  emergencyLaunchReason: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
};
const idle: UpdatesSnapshot = {
  currentlyRunning: running,
  isUpdateAvailable: false,
  isUpdatePending: false,
  isDownloading: false,
  isRestarting: false,
};
// An update of a bundle plus 49 images, like a real export.
const newUpdate = {
  type: 'new',
  updateId: 'b7e0c3c2-3f7a-4b5e-9a51-8a3c2d1e0f00',
  createdAt: new Date('2026-10-16T00:00:00Z'),
  manifest: { id: 'b7e0c3c2-3f7a-4b5e-9a51-8a3c2d1e0f00', launchAsset: {}, assets: new Array(49).fill({}), metadata: {} },
} as unknown as UpdatesSnapshot['availableUpdate'];
const rollback = (createdAt: string) =>
  ({ type: 'rollback', createdAt: new Date(createdAt) }) as unknown as UpdatesSnapshot['availableUpdate'];
const derive = (updates: Partial<UpdatesSnapshot>, local: Partial<Parameters<typeof deriveOtaScreen>[1]> = {}) =>
  deriveOtaScreen({ ...idle, ...updates }, { dismissed: false, restarting: false, slow: false, ...local });

describe('unit - OTA update screen', () => {
  describe('lastFileProgress', () => {
    it('shows the bytes of the last file left as the whole bar', () => {
      expect(lastFileProgress(0.99, 50)).toBeCloseTo(0.5);
      expect(lastFileProgress(0.5, 1)).toBe(0.5);
    });

    it('has nothing to show while other files are still pending, or once it is done', () => {
      expect(lastFileProgress(0, 50)).toBeNull();
      expect(lastFileProgress(0.98, 50)).toBeNull();
      expect(lastFileProgress(1, 50)).toBeNull();
      expect(lastFileProgress(undefined, 50)).toBeNull();
      expect(lastFileProgress(0.5, 0)).toBeNull();
    });
  });

  describe('deriveOtaScreen', () => {
    it('stays hidden while nothing is found, checked or failed to check', () => {
      expect(derive({})).toEqual({ kind: 'hidden' });
      expect(derive({ isUpdateAvailable: true })).toEqual({ kind: 'hidden' });
      expect(derive({ downloadError: new Error('offline') })).toEqual({ kind: 'hidden' });
    });

    it('shows the download, indeterminate until the last file reports its bytes', () => {
      const downloading = { isUpdateAvailable: true, isDownloading: true, availableUpdate: newUpdate };
      expect(derive({ ...downloading, downloadProgress: 0.98 })).toEqual({ kind: 'downloading', progress: null, slow: false });
      expect(derive({ ...downloading, downloadProgress: 0.99 })).toEqual({
        kind: 'downloading',
        progress: expect.closeTo(0.5),
        slow: false,
      });
      expect(derive({ isDownloading: true, downloadProgress: 0.5 })).toEqual({ kind: 'downloading', progress: null, slow: false });
      expect(derive(downloading, { slow: true })).toEqual({ kind: 'downloading', progress: null, slow: true });
    });

    it('asks for a restart once the update is downloaded', () => {
      expect(derive({ isUpdateAvailable: true, isUpdatePending: true, downloadedUpdate: newUpdate } as Partial<UpdatesSnapshot>)).toEqual({
        kind: 'ready',
      });
    });

    it('offers a retry after a failed download, and shows the retry as a download', () => {
      const failed = { isUpdateAvailable: true, downloadError: new Error('offline') };
      expect(derive(failed)).toEqual({ kind: 'error' });
      // The Download event doesn't clear the last error.
      expect(derive({ ...failed, isDownloading: true })).toEqual({ kind: 'downloading', progress: null, slow: false });
    });

    it('asks for a restart for a roll-back newer than the running update, and ignores an old one', () => {
      expect(derive({ isUpdateAvailable: true, availableUpdate: rollback('2026-10-16T00:00:00Z') })).toEqual({ kind: 'ready' });
      expect(derive({ isUpdateAvailable: true, availableUpdate: rollback('2026-09-01T00:00:00Z') })).toEqual({ kind: 'hidden' });
    });

    it('shows the restart in progress, and nothing once dismissed', () => {
      expect(derive({ isUpdatePending: true, isRestarting: true })).toEqual({ kind: 'restarting' });
      expect(derive({ isUpdatePending: true }, { restarting: true })).toEqual({ kind: 'restarting' });
      expect(derive({ isDownloading: true }, { dismissed: true })).toEqual({ kind: 'hidden' });
    });
  });

  describe('useOtaUpdate', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationContainer theme={ShroudDefaultTheme}>{children}</NavigationContainer>
    );
    const renderOta = () => renderHook(() => useOtaUpdate(), { wrapper });

    beforeEach(() => {
      mockUpdates.isEnabled = true;
      mockGateEnabled.mockReturnValue(true);
      mockUpdates.useUpdates.mockReturnValue({ ...idle, isUpdateAvailable: true, isUpdatePending: true });
      mockUpdates.reloadAsync.mockReset().mockResolvedValue(undefined);
      mockUpdates.fetchUpdateAsync.mockReset().mockResolvedValue({ isNew: true });
    });
    afterEach(() => jest.useRealTimers());

    it.each([
      ['in development or under Detox', () => mockGateEnabled.mockReturnValue(false)],
      ['when expo-updates is off', () => (mockUpdates.isEnabled = false)],
    ])('stays hidden %s', async (_, arrange) => {
      arrange();
      const { result } = renderOta();
      await act(async () => {});
      expect(result.current.screen).toEqual({ kind: 'hidden' });
    });

    it('restarts into the update behind a reload screen in the theme colours', async () => {
      const { result } = renderOta();
      await act(async () => {});
      expect(result.current.screen).toEqual({ kind: 'ready' });

      await act(async () => result.current.restart());

      expect(mockUpdates.reloadAsync).toHaveBeenCalledWith({
        reloadScreenOptions: {
          backgroundColor: ShroudDefaultTheme.colors.background,
          spinner: { enabled: true, color: ShroudDefaultTheme.colors.brandPrimary },
          fade: true,
        },
      });
      expect(result.current.screen).toEqual({ kind: 'restarting' });
    });

    it('lets the user back in when the restart fails', async () => {
      mockUpdates.reloadAsync.mockRejectedValue(new Error('ERR_UPDATES_RELOAD'));
      const { result } = renderOta();
      await act(async () => {});

      await act(async () => result.current.restart());

      expect(result.current.screen).toEqual({ kind: 'hidden' });
    });

    it('retries the download, and Continue hides the screen for the session', async () => {
      mockUpdates.useUpdates.mockReturnValue({ ...idle, isUpdateAvailable: true, downloadError: new Error('offline') });
      mockUpdates.fetchUpdateAsync.mockRejectedValue(new Error('ERR_UPDATES_FETCH'));
      const { result } = renderOta();
      await act(async () => {});
      expect(result.current.screen).toEqual({ kind: 'error' });

      await act(async () => result.current.retry());
      expect(mockUpdates.fetchUpdateAsync).toHaveBeenCalledTimes(1);

      act(() => result.current.dismiss());
      expect(result.current.screen).toEqual({ kind: 'hidden' });
    });

    it('offers to carry on once a download has run for a minute, and starts over for a retry', () => {
      jest.useFakeTimers();
      const downloading = { ...idle, isUpdateAvailable: true, isDownloading: true };
      mockUpdates.useUpdates.mockReturnValue(downloading);
      const { result, rerender } = renderOta();
      expect(result.current.screen).toEqual({ kind: 'downloading', progress: null, slow: false });

      act(() => jest.advanceTimersByTime(SLOW_DOWNLOAD_MS - 1));
      expect(result.current.screen).toMatchObject({ slow: false });
      act(() => jest.advanceTimersByTime(1));
      expect(result.current.screen).toMatchObject({ slow: true });

      mockUpdates.useUpdates.mockReturnValue({ ...idle, isUpdateAvailable: true, downloadError: new Error('offline') });
      rerender({});
      expect(result.current.screen).toEqual({ kind: 'error' });
      mockUpdates.useUpdates.mockReturnValue(downloading);
      rerender({});
      expect(result.current.screen).toMatchObject({ kind: 'downloading', slow: false });
      act(() => jest.advanceTimersByTime(SLOW_DOWNLOAD_MS));
      expect(result.current.screen).toMatchObject({ slow: true });
    });
  });
});
