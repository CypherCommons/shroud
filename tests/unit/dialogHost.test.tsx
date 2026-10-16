import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import DialogHost from '../../components/Dialog/DialogHost';
import { DialogRequest, enqueueDialog, resetDialogs, subscribeDialogs } from '../../components/Dialog/dialogStore';

const renderHost = () =>
  render(
    <NavigationContainer>
      <DialogHost />
    </NavigationContainer>,
  );

const show = (request: DialogRequest) => act(() => enqueueDialog(request));

describe('unit - DialogHost', () => {
  beforeEach(() => resetDialogs());

  it('closes the dialog before running the pressed button, so the handler can open the next one', () => {
    const shown: (DialogRequest | null)[] = [];
    const unsubscribe = subscribeDialogs(current => shown.push(current));
    let showingWhenPressed: DialogRequest | null | undefined;
    renderHost();
    show({ title: 'Saved', buttons: [{ text: 'OK', onPress: () => (showingWhenPressed = shown[shown.length - 1]) }] });

    fireEvent.press(screen.getByText('OK'));

    expect(showingWhenPressed).toBeNull();
    expect(screen.queryByTestId('Dialog')).toBeNull();
    unsubscribe();
  });

  it('passes the typed text to the pressed button, and Done presses the confirm button', () => {
    const onPress = jest.fn();
    renderHost();
    show({ title: 'Password', input: { secure: true }, buttons: [{ text: 'OK', onPress }] });

    fireEvent.changeText(screen.getByTestId('DialogInput'), 'hunter2');
    fireEvent.press(screen.getByText('OK'));
    expect(onPress).toHaveBeenCalledWith('hunter2');

    show({ title: 'Password', input: { secure: true }, buttons: [{ text: 'OK', onPress }] });
    fireEvent.changeText(screen.getByTestId('DialogInput'), 'second');
    fireEvent(screen.getByTestId('DialogInput'), 'submitEditing');
    expect(onPress).toHaveBeenLastCalledWith('second');
  });

  it('closes on a tap outside only when cancelable, and then runs onDismiss', () => {
    const onDismiss = jest.fn();
    renderHost();

    show({ title: 'Stuck', buttons: [{ text: 'OK' }], onDismiss });
    fireEvent.press(screen.getByTestId('DialogScrim'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('OK'));

    show({ title: 'Closable', buttons: [{ text: 'OK' }], cancelable: true, onDismiss });
    fireEvent.press(screen.getByTestId('DialogScrim'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('Dialog')).toBeNull();
  });

  it('puts the cancel button last', () => {
    renderHost();
    show({
      title: 'Delete wallet?',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive' },
      ],
    });

    expect(screen.getAllByText(/^(Cancel|Delete)$/).map(node => node.props.children)).toEqual(['Delete', 'Cancel']);
  });
});
