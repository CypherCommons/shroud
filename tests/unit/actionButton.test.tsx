import React from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import ActionButton from '../../components/ActionButton';
import { IconProps } from '../../components/icons/types';
import { ShroudDefaultTheme } from '../../components/themes';

// Reports the tint it was drawn in.
const Glyph: React.FC<IconProps> = ({ color }) => <View testID="Glyph" accessibilityLabel={color} />;

const renderButton = (props: Partial<React.ComponentProps<typeof ActionButton>> = {}) => {
  const onPress = jest.fn();
  render(
    <NavigationContainer theme={ShroudDefaultTheme}>
      <ActionButton
        title="Check again"
        onPress={onPress}
        Icon={Glyph}
        backgroundColor="#111111"
        color="#222222"
        testID="Button"
        {...props}
      />
    </NavigationContainer>,
  );
  return { onPress, colors: ShroudDefaultTheme.colors };
};

describe('unit - ActionButton', () => {
  it('tints the icon apart from the title when asked to', () => {
    renderButton({ iconColor: '#333333' });

    expect(screen.getByTestId('Glyph').props.accessibilityLabel).toBe('#333333');
    expect(screen.getByText('Check again')).toHaveStyle({ color: '#222222' });
  });

  it('greys the icon out with the rest of a disabled button', () => {
    const { colors, onPress } = renderButton({ iconColor: '#333333', disabled: true });

    expect(screen.getByTestId('Glyph').props.accessibilityLabel).toBe(colors.textMuted);
    fireEvent.press(screen.getByTestId('Button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows a spinner in the icon’s place while loading, keeps its colours and ignores presses', () => {
    const { onPress } = renderButton({ loading: true });

    expect(screen.queryByTestId('Glyph')).toBeNull();
    expect(screen.getByTestId('ButtonSpinner')).toBeTruthy();
    expect(screen.getByTestId('Button')).toBeBusy();
    expect(screen.getByTestId('Button')).toBeDisabled();
    expect(StyleSheet.flatten(screen.getByTestId('Button').props.style)).toMatchObject({ backgroundColor: '#111111' });

    fireEvent.press(screen.getByTestId('Button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('presses through when idle', () => {
    const { onPress } = renderButton();

    expect(screen.getByTestId('Button')).not.toBeBusy();
    fireEvent.press(screen.getByTestId('Button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
