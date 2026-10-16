import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import PillSegmentedControl from '../../components/PillSegmentedControl';

jest.mock('../../modules/hapticFeedback');

const segments = [
  { label: 'sats', testID: 'Unit-sats' },
  { label: 'BTC', testID: 'Unit-BTC' },
  { label: 'INR', testID: 'Unit-fiat', disabled: true },
];

// useTheme reads the navigation theme, so the control needs a real NavigationContainer.
const renderControl = (onChange: jest.Mock) =>
  render(
    <NavigationContainer>
      <PillSegmentedControl segments={segments} selectedIndex={0} onChange={onChange} />
    </NavigationContainer>,
  );

describe('unit - PillSegmentedControl', () => {
  it('reports the index of a newly picked segment', () => {
    const onChange = jest.fn();
    renderControl(onChange);

    expect(screen.getByTestId('Unit-sats')).toBeSelected();
    fireEvent.press(screen.getByTestId('Unit-BTC'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('ignores the segment that is already picked', () => {
    const onChange = jest.fn();
    renderControl(onChange);

    fireEvent.press(screen.getByTestId('Unit-sats'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a disabled segment in place without letting it be picked', () => {
    const onChange = jest.fn();
    renderControl(onChange);

    expect(screen.getByTestId('Unit-fiat')).toBeDisabled();
    expect(screen.getByText('INR')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Unit-fiat'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
