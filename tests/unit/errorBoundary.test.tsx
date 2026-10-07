import assert from 'assert';
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ErrorBoundary } from '../../components/ErrorBoundary';

let shouldThrow = true;
const Flaky = () => {
  if (shouldThrow) throw new Error('boom');
  return <Text>recovered</Text>;
};

describe('unit - ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    shouldThrow = false;
    const { getByText, queryByTestId } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    getByText('recovered');
    assert.strictEqual(queryByTestId('CrashScreen'), null);
  });

  it('shows the crash screen instead of unmounting the app when a child throws', () => {
    const { getByTestId } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    getByTestId('CrashScreen');
  });

  it('catches errors thrown inside effects', () => {
    const ThrowsInEffect = () => {
      React.useEffect(() => {
        throw new Error('boom');
      }, []);
      return null;
    };
    const { getByTestId } = render(
      <ErrorBoundary>
        <ThrowsInEffect />
      </ErrorBoundary>,
    );
    getByTestId('CrashScreen');
  });

  it('remounts the children on retry', () => {
    const { getByTestId, getByText } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.press(getByTestId('CrashRetryButton'));
    getByText('recovered');
  });
});
