import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import ProgressBar from '../../components/ProgressBar';

const inContainer = (progress: number | null) => (
  <NavigationContainer>
    <ProgressBar progress={progress} testID="Bar" />
  </NavigationContainer>
);

const layOut = (width: number) =>
  fireEvent(screen.getByTestId('Bar'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 8 } } });
const fillStyle = () => StyleSheet.flatten(screen.getByTestId('BarFill').props.style);

describe('unit - ProgressBar', () => {
  afterEach(() => jest.useRealTimers());

  it('starts at its value instead of growing from empty, before and after its first layout', () => {
    render(inContainer(0.5));
    expect(fillStyle().width).toBe('50%');

    layOut(200);
    expect(fillStyle()).toMatchObject({ width: 200, transform: [{ translateX: -100 }] });
  });

  it('slides to a new value on the native driver, so it keeps moving while the JS thread is busy', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const { rerender } = render(inContainer(0.5));
    layOut(200);

    rerender(inContainer(1));

    expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, useNativeDriver: true }));
    timing.mockRestore();
  });

  it('sweeps, with no value to report, while there is no progress to show', () => {
    render(inContainer(null));
    layOut(200);

    expect(screen.queryByTestId('BarFill')).toBeNull();
    expect(screen.getByTestId('Bar').props.accessibilityValue).toBeUndefined();
    expect(screen.getByTestId('Bar')).toBeBusy();
  });
});
