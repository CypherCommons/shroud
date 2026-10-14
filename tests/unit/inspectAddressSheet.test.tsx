import React, { createRef } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { BottomModalHandle } from '../../components/BottomModal';
import InspectAddressSheet from '../../components/InspectAddressSheet';
import loc from '../../loc';

jest.mock('../../modules/hapticFeedback');

const ADDRESS = 'bc1qfm3u2f2e2mqzhc53d24c0tqg2zlwrgdqmjuj0p';

const renderSheet = () => {
  const ref = createRef<BottomModalHandle>();
  const utils = render(
    <NavigationContainer>
      <InspectAddressSheet ref={ref} address={ADDRESS} />
    </NavigationContainer>,
  );
  // Not awaited inside act: the mock resolves present() only once its state update commits, and
  // act holds that update back until its callback is done.
  const present = () =>
    act(() => {
      ref.current!.present();
    });
  return { ...utils, present };
};

describe('unit - InspectAddressSheet', () => {
  beforeEach(() => {
    (Clipboard.setString as jest.Mock).mockClear();
  });

  it('lays the address out in groups of four once presented', () => {
    const { getByLabelText, getByText, queryByTestId, present } = renderSheet();
    expect(queryByTestId('InspectAddressSheet')).toBeNull();

    present();

    getByLabelText('bc1q fm3u 2f2e 2mqz hc53 d24c 0tqg 2zlw rgdq mjuj 0p');
    getByText('bc1q');
    getByText('mjuj');
  });

  it('copies the whole address', () => {
    const { getByTestId, getByText, present } = renderSheet();
    present();

    fireEvent.press(getByTestId('InspectAddressCopyButton'));

    expect(Clipboard.setString).toHaveBeenCalledWith(ADDRESS);
    getByText(loc.receive.copied);
  });
});
