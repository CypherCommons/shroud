import React from 'react';
import { AccessibilityInfo, Linking, Platform, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import UpdateGate from '../../components/UpdateGate';
import { OtaUpdateScreen, UpdateRequiredScreen } from '../../components/UpdateScreens';
import { STORE_LINKS } from '../../constants/links';
import { OtaScreen, useOtaUpdate } from '../../hooks/useOtaUpdate';
import { useUpdateRequired } from '../../hooks/useUpdateRequired';
import loc from '../../loc';

jest.mock('../../hooks/useUpdateRequired', () => ({ useUpdateRequired: jest.fn() }));
jest.mock('../../hooks/useOtaUpdate', () => ({ useOtaUpdate: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockUseUpdateRequired = useUpdateRequired as jest.MockedFunction<typeof useUpdateRequired>;
const mockUseOtaUpdate = useOtaUpdate as jest.MockedFunction<typeof useOtaUpdate>;

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </SafeAreaProvider>
);
const inContainer = (element: React.ReactElement) => render(element, { wrapper: Wrapper });

describe('unit - update screens', () => {
  describe('UpdateRequiredScreen', () => {
    const os = Platform.OS;
    let openURL: jest.SpyInstance;

    beforeEach(() => {
      openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    });
    afterEach(() => {
      openURL.mockRestore();
      Platform.OS = os;
    });

    it('sends a blocked iOS build to the App Store', () => {
      inContainer(<UpdateRequiredScreen />);

      expect(screen.getByText(loc.updates.required_title)).toBeTruthy();
      fireEvent.press(screen.getByText(loc.updates.required_open_app_store));
      expect(openURL).toHaveBeenCalledWith(STORE_LINKS.ios);
    });

    it('sends a blocked Android build to Google Play', () => {
      Platform.OS = 'android';
      inContainer(<UpdateRequiredScreen />);

      fireEvent.press(screen.getByText(loc.updates.required_open_play_store));
      expect(openURL).toHaveBeenCalledWith(STORE_LINKS.android);
    });
  });

  describe('OtaUpdateScreen', () => {
    const handlers = { onRestart: jest.fn(), onRetry: jest.fn(), onContinue: jest.fn() };
    const show = (state: Exclude<OtaScreen, { kind: 'hidden' }>) => inContainer(<OtaUpdateScreen screen={state} {...handlers} />);

    beforeEach(() => Object.values(handlers).forEach(handler => handler.mockClear()));

    it('holds the app on the download with no way out, until it runs long', () => {
      const { rerender } = show({ kind: 'downloading', progress: null, slow: false });

      expect(screen.getByText(loc.updates.downloading_title)).toBeTruthy();
      expect(screen.getByTestId('OtaProgressBar')).toBeTruthy();
      expect(screen.queryByText(/%$/)).toBeNull();
      expect(screen.queryByTestId('OtaContinueButton')).toBeNull();

      rerender(<OtaUpdateScreen screen={{ kind: 'downloading', progress: 0.42, slow: true }} {...handlers} />);
      expect(screen.getByText('42%')).toBeTruthy();
      fireEvent.press(screen.getByTestId('OtaContinueButton'));
      expect(handlers.onContinue).toHaveBeenCalledTimes(1);
    });

    it('restarts once the update is ready, and shows the restart under way', () => {
      const { rerender } = show({ kind: 'ready' });

      // The finished download stays on screen, full.
      expect(screen.getByTestId('OtaProgressBar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
      fireEvent.press(screen.getByTestId('OtaRestartButton'));
      expect(handlers.onRestart).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('OtaContinueButton')).toBeNull();

      rerender(<OtaUpdateScreen screen={{ kind: 'restarting' }} {...handlers} />);
      expect(screen.getByTestId('OtaRestartingIndicator')).toBeTruthy();
      expect(screen.queryByTestId('OtaRestartButton')).toBeNull();
    });

    it('offers a retry or the current version after a failed download', () => {
      show({ kind: 'error' });

      expect(screen.getByText(loc.updates.error_title)).toBeTruthy();
      expect(screen.queryByTestId('OtaProgressBar')).toBeNull();
      fireEvent.press(screen.getByTestId('OtaRetryButton'));
      fireEvent.press(screen.getByTestId('OtaContinueButton'));
      expect(handlers.onRetry).toHaveBeenCalledTimes(1);
      expect(handlers.onContinue).toHaveBeenCalledTimes(1);
    });

    it('tells screen readers when the state changes under them', () => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      const { rerender } = show({ kind: 'downloading', progress: null, slow: false });
      expect(announce).toHaveBeenLastCalledWith(loc.updates.downloading_title);

      rerender(<OtaUpdateScreen screen={{ kind: 'ready' }} {...handlers} />);
      expect(announce).toHaveBeenLastCalledWith(loc.updates.ready_title);
      // Android reads out the title's live region by itself.
      expect(screen.getByText(loc.updates.ready_title).props.accessibilityLiveRegion).toBe('polite');
      announce.mockRestore();
    });
  });

  describe('UpdateGate', () => {
    const ota = (state: OtaScreen) => ({ screen: state, restart: jest.fn(), retry: jest.fn(), dismiss: jest.fn() });
    const renderGate = () =>
      inContainer(
        <UpdateGate>
          <Text>App</Text>
        </UpdateGate>,
      );

    beforeEach(() => mockUseOtaUpdate.mockReturnValue(ota({ kind: 'hidden' })));

    it("renders nothing until the saved policy is read, so the app doesn't start under a block", () => {
      mockUseUpdateRequired.mockReturnValue(undefined);
      renderGate();
      expect(screen.queryByText('App')).toBeNull();
    });

    it('puts a required update ahead of an over-the-air one', () => {
      mockUseUpdateRequired.mockReturnValue(true);
      mockUseOtaUpdate.mockReturnValue(ota({ kind: 'ready' }));
      renderGate();
      expect(screen.getByTestId('UpdateRequiredScreen')).toBeTruthy();
      expect(screen.queryByTestId('OtaUpdateScreen')).toBeNull();
      expect(screen.queryByText('App')).toBeNull();
    });

    it('shows the over-the-air update in place of the app, and the app otherwise', () => {
      mockUseUpdateRequired.mockReturnValue(false);
      mockUseOtaUpdate.mockReturnValue(ota({ kind: 'downloading', progress: null, slow: false }));
      const { rerender } = renderGate();
      expect(screen.getByTestId('OtaUpdateScreen')).toBeTruthy();
      expect(screen.queryByText('App')).toBeNull();

      mockUseOtaUpdate.mockReturnValue(ota({ kind: 'hidden' }));
      rerender(
        <UpdateGate>
          <Text>App</Text>
        </UpdateGate>,
      );
      expect(screen.getByText('App')).toBeTruthy();
    });
  });
});
