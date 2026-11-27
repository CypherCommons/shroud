import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import IndexerSettings from '../../screen/settings/IndexerSettings';
import { useStorage } from '../../hooks/context/useStorage';
import presentAlert from '../../components/Alert';
import { getIndexerConfig, getIndexerPreference, saveIndexerPreference } from '../../modules/indexerPreference';
import { getDefaultIndexer, initializeIndexer, SilentPaymentIndexer } from '../../modules/SilentPaymentIndexer';
import { getNetwork, setActiveNetwork } from '../../modules/network';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../components/Alert', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </SafeAreaProvider>
);

beforeEach(async () => {
  jest.clearAllMocks();
  setActiveNetwork('bitcoin');
  await saveIndexerPreference('bitcoin');
  initializeIndexer(getIndexerConfig('bitcoin'));
  (useStorage as jest.Mock).mockReturnValue({ activeNetworkId: 'bitcoin' });
  jest.spyOn(SilentPaymentIndexer.prototype, 'getHealth').mockResolvedValue({ status: 'ok' });
  jest.spyOn(SilentPaymentIndexer.prototype, 'getLatestBlockHeight').mockResolvedValue({ height: 900000 });
});
afterEach(() => jest.restoreAllMocks());

it('tests and saves the custom endpoint and immediately applies it', async () => {
  const { getByTestId } = render(<IndexerSettings />, { wrapper: Wrapper });
  fireEvent.changeText(getByTestId('IndexerUrlInput'), 'https://custom.example/');
  fireEvent.press(getByTestId('SaveIndexerButton'));
  await waitFor(() => expect(presentAlert).toHaveBeenCalled());
  expect(getIndexerPreference('bitcoin')?.baseUrl).toBe('https://custom.example');
  expect(getDefaultIndexer().getBaseUrl()).toBe('https://custom.example');
});

it('keeps the current configuration when the custom endpoint fails its test', async () => {
  jest.spyOn(SilentPaymentIndexer.prototype, 'getHealth').mockRejectedValue(new Error('offline'));
  const { getByTestId } = render(<IndexerSettings />, { wrapper: Wrapper });
  fireEvent.changeText(getByTestId('IndexerUrlInput'), 'https://offline.example');
  fireEvent.press(getByTestId('SaveIndexerButton'));
  await waitFor(() => expect(presentAlert).toHaveBeenCalled());
  expect(getIndexerPreference('bitcoin')).toBeUndefined();
  expect(getDefaultIndexer().getBaseUrl()).toBe(getNetwork('bitcoin').indexerBaseUrl);
});

it('removes the saved custom endpoint when Use default is pressed', async () => {
  await saveIndexerPreference('bitcoin', { baseUrl: 'https://custom.example' });
  initializeIndexer(getIndexerConfig('bitcoin'));
  const { getByTestId } = render(<IndexerSettings />, { wrapper: Wrapper });
  fireEvent.press(getByTestId('ResetIndexerButton'));
  await waitFor(() => expect(presentAlert).toHaveBeenCalled());
  expect(getIndexerPreference('bitcoin')).toBeUndefined();
  expect(getDefaultIndexer().getBaseUrl()).toBe(getNetwork('bitcoin').indexerBaseUrl);
});
