import React from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render } from '@testing-library/react-native';

import AddressCopyCard from '../../components/AddressCopyCard';
import loc from '../../loc';

jest.mock('../../modules/hapticFeedback');

// The silent payment address from BIP 352's examples.
const ADDRESS = 'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv';

const renderCard = (props: Partial<React.ComponentProps<typeof AddressCopyCard>> = {}) =>
  render(
    <NavigationContainer>
      <AddressCopyCard text={ADDRESS} {...props} />
    </NavigationContainer>,
  );

describe('unit - AddressCopyCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Clipboard.setString as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows only the first and last eight characters', () => {
    const { getByText, queryByText } = renderCard();

    getByText('sp1qqgst...xc9pkqwv');
    expect(queryByText(ADDRESS)).toBeNull();
  });

  it('copies the whole address on a tap, and says so for a moment', () => {
    const { getByTestId, getByText } = renderCard();

    fireEvent.press(getByTestId('AddressCopyCard'));

    expect(Clipboard.setString).toHaveBeenCalledWith(ADDRESS);
    getByText(loc.receive.copied);

    act(() => jest.advanceTimersByTime(1000));
    getByText(loc.receive.tap_to_copy);
  });

  it('opens the inspector from the eye button without copying', () => {
    const onInspect = jest.fn();
    const { getByTestId } = renderCard({ onInspect });

    fireEvent.press(getByTestId('AddressCopyCardInspectButton'));

    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(Clipboard.setString).not.toHaveBeenCalled();
  });

  it('has no eye button when there is nothing to inspect with', () => {
    const { queryByTestId } = renderCard();

    expect(queryByTestId('AddressCopyCardInspectButton')).toBeNull();
  });
});
