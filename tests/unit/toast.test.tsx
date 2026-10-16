import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, render, screen } from '@testing-library/react-native';

import Toast from '../../components/Toast';

describe('unit - Toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const renderToast = (visible: boolean, onHide: () => void) =>
    render(
      <NavigationContainer>
        <Toast visible={visible} title="No balance" onHide={onHide} testID="Toast" />
      </NavigationContainer>,
    );

  it('asks to be hidden after 4 seconds', () => {
    const onHide = jest.fn();
    renderToast(true, onHide);

    expect(screen.getByTestId('Toast')).toBeTruthy();
    act(() => jest.advanceTimersByTime(3999));
    expect(onHide).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('stays up through the fade-out, then unmounts, and shows again with a fresh timer', () => {
    const onHide = jest.fn();
    const { rerender } = renderToast(true, onHide);
    const update = (visible: boolean) =>
      rerender(
        <NavigationContainer>
          <Toast visible={visible} title="No balance" onHide={onHide} testID="Toast" />
        </NavigationContainer>,
      );

    update(false);
    expect(screen.getByTestId('Toast')).toBeTruthy();
    act(() => jest.runAllTimers());
    expect(screen.queryByTestId('Toast')).toBeNull();
    onHide.mockClear();

    update(true);
    expect(screen.getByTestId('Toast')).toBeTruthy();
    act(() => jest.advanceTimersByTime(4000));
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
