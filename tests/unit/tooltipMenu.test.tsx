import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { fireEvent, render, userEvent, within } from '@testing-library/react-native';

import ToolTipMenu from '../../components/TooltipMenu';
import { ToolTipMenuProps } from '../../components/types';

// A host view standing in for the native menu, so the tree shows where it sits.
jest.mock('@react-native-menu/menu', () => {
  const { View } = jest.requireActual('react-native');
  return { MenuView: (props: object) => <View testID="MenuView" {...props} /> };
});

const renderMenu = (props: Partial<ToolTipMenuProps>) =>
  render(
    <ToolTipMenu actions={[{ id: 'copy', text: 'Copy' }]} onPressMenuItem={jest.fn()} testID="Touchable" {...props}>
      <Text>Row</Text>
    </ToolTipMenu>,
  );

describe('unit - ToolTipMenu', () => {
  const originalOS = Platform.OS;
  const setOS = (os: typeof Platform.OS) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

  afterEach(() => setOS(originalOS));

  describe('a button whose menu opens on long press', () => {
    // MenuView's native button sits above its React children on iOS, so a touchable inside the
    // menu would never be tapped.
    it('on iOS, lays the menu over the touchable content, inside the touchable', () => {
      setOS('ios');
      const onPress = jest.fn();
      const screen = renderMenu({ isButton: true, onPress });

      const menu = within(screen.getByTestId('Touchable')).getByTestId('MenuView');
      expect(menu.props.shouldOpenOnLongPress).toBe(true);
      expect(StyleSheet.flatten(menu.props.style)).toEqual(StyleSheet.flatten(StyleSheet.absoluteFill));

      fireEvent.press(screen.getByTestId('Touchable'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    // On Android a touchable owning the gesture would take it from the native menu inside it.
    it('on Android, keeps the touchable inside the menu', () => {
      setOS('android');
      const screen = renderMenu({ isButton: true, onPress: jest.fn() });

      expect(within(screen.getByTestId('MenuView')).getByTestId('Touchable')).toBeTruthy();
    });

    it.each(['ios', 'android'] as const)('on %s, does not also fire onPress when the long press ends', async os => {
      setOS(os);
      jest.useFakeTimers();
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const onPress = jest.fn();
      const screen = renderMenu({ isButton: true, onPress });

      await user.longPress(screen.getByTestId('Touchable'), { duration: 800 });
      expect(onPress).not.toHaveBeenCalled();

      await user.press(screen.getByTestId('Touchable'));
      expect(onPress).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });

  it('wraps the touchable in a menu that opens on tap', () => {
    setOS('ios');
    const screen = renderMenu({ isButton: true, isMenuPrimaryAction: true });

    const menu = screen.getByTestId('MenuView');
    expect(menu.props.shouldOpenOnLongPress).toBe(false);
    expect(within(menu).getByTestId('Touchable')).toBeTruthy();
  });

  it('wraps plain content in the menu when it is not a button', () => {
    const screen = renderMenu({});
    expect(within(screen.getByTestId('MenuView')).getByText('Row')).toBeTruthy();
    expect(screen.queryByTestId('Touchable')).toBeNull();
  });
});
