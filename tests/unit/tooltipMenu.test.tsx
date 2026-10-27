import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, userEvent, waitFor, within } from '@testing-library/react-native';

import ToolTipMenu from '../../components/TooltipMenu';
import { Action, ToolTipMenuProps } from '../../components/types';

const ACTIONS: Action[][] = [
  [
    { id: 'copy', text: 'Copy' },
    { id: 'gone', text: 'Gone', hidden: true },
  ],
  [
    { id: 'on', text: 'On', menuState: true },
    { id: 'off', text: 'Off', menuState: false },
  ],
];

const renderMenu = (props: Partial<ToolTipMenuProps>) =>
  render(
    <NavigationContainer>
      <ToolTipMenu actions={ACTIONS} onPressMenuItem={jest.fn()} testID="Touchable" {...props}>
        <Text>Row</Text>
      </ToolTipMenu>
    </NavigationContainer>,
  );

describe('unit - ToolTipMenu', () => {
  it('opens on tap when the menu is the primary action, listing the visible actions under the title', async () => {
    const screen = renderMenu({ isButton: true, isMenuPrimaryAction: true, title: 'Network' });
    expect(screen.queryByTestId('ToolTipMenuSheet')).toBeNull();

    await act(async () => fireEvent.press(screen.getByTestId('Touchable')));

    const sheet = within(screen.getByTestId('ToolTipMenuSheet'));
    expect(sheet.getByText('Network')).toBeTruthy();
    expect(sheet.getByText('Copy')).toBeTruthy();
    expect(sheet.queryByText('Gone')).toBeNull();
  });

  it('shows a checkbox on items that are on or off, and none on plain actions', async () => {
    const screen = renderMenu({ isButton: true, isMenuPrimaryAction: true });
    await act(async () => fireEvent.press(screen.getByTestId('Touchable')));

    expect(screen.getByTestId('ToolTipMenuItem-copy').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('ToolTipMenuItem-on').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('ToolTipMenuItem-off').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('closes the sheet before handing over the picked item', async () => {
    const onPressMenuItem = jest.fn();
    const screen = renderMenu({ isButton: true, isMenuPrimaryAction: true, onPressMenuItem });
    await act(async () => fireEvent.press(screen.getByTestId('Touchable')));

    fireEvent.press(screen.getByTestId('ToolTipMenuItem-off'));

    await waitFor(() => expect(onPressMenuItem).toHaveBeenCalledWith('off'));
    expect(screen.queryByText('Off')).toBeNull();
  });

  it('on a button whose menu opens on long press, a tap is still a tap', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onPress = jest.fn();
    const screen = renderMenu({ isButton: true, onPress });

    await user.press(screen.getByTestId('Touchable'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ToolTipMenuSheet')).toBeNull();

    await user.longPress(screen.getByTestId('Touchable'), { duration: 800 });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ToolTipMenuSheet')).toBeTruthy();
    jest.useRealTimers();
  });

  it('opens on long press over plain content', async () => {
    const screen = renderMenu({});
    await act(async () => fireEvent(screen.getByText('Row'), 'longPress'));
    expect(screen.getByTestId('ToolTipMenuSheet')).toBeTruthy();
  });

  it('does not open while disabled', async () => {
    const screen = renderMenu({ isButton: true, isMenuPrimaryAction: true, disabled: true });
    await act(async () => fireEvent.press(screen.getByTestId('Touchable')));
    expect(screen.queryByTestId('ToolTipMenuSheet')).toBeNull();
  });
});
