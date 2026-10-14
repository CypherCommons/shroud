import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render } from '@testing-library/react-native';

import QRCard from '../../components/QRCard';

// Stands in for the SVG code, so a test can read the size it was drawn at.
jest.mock('../../components/QRCodeComponent', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: (props: object) => <View testID="QRCode" {...props} /> };
});

const renderCard = (size?: number) =>
  render(
    <NavigationContainer>
      <QRCard value="bitcoin:bc1qfm3u2f2e2mqzhc53d24c0tqg2zlwrgdqmjuj0p" size={size} />
    </NavigationContainer>,
  );

const layOut = (utils: ReturnType<typeof renderCard>, width: number, height: number) =>
  fireEvent(utils.root, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });

describe('unit - QRCard', () => {
  it('draws a fixed size straight away', () => {
    const utils = renderCard(200);

    expect(utils.getByTestId('QRCode').props.size).toBe(200);
  });

  describe('without a size', () => {
    it('draws nothing until it knows how much room it has', () => {
      const utils = renderCard();

      expect(utils.queryByTestId('QRCode')).toBeNull();
    });

    it('fits the code inside the card, padding included', () => {
      const utils = renderCard();

      layOut(utils, 354, 400);
      expect(utils.getByTestId('QRCode').props.size).toBe(354 - 44);

      layOut(utils, 354, 250);
      expect(utils.getByTestId('QRCode').props.size).toBe(250 - 44);
    });

    it('stops growing on a large screen', () => {
      const utils = renderCard();

      layOut(utils, 900, 1200);
      expect(utils.getByTestId('QRCode').props.size).toBe(500);
    });
  });
});
