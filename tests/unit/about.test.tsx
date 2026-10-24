import React from 'react';
import { Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import About from '../../screen/settings/About';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';

jest.mock('../../hooks/useExtendedNavigation');
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
}));

describe('unit - About', () => {
  beforeEach(() => {
    (useExtendedNavigation as jest.Mock).mockReturnValue({ navigate: jest.fn() });
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    render(
      <NavigationContainer>
        <About />
      </NavigationContainer>,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('shows the letter, signed', () => {
    expect(screen.getByText(loc.settings.about_letter_opening)).toBeTruthy();
    expect(screen.getByText(loc.settings.about_letter_thanks)).toBeTruthy();
    expect(screen.getByText(loc.settings.about_letter_signature)).toBeTruthy();
    expect(screen.getByText(loc.settings.about_letter_signature_role)).toBeTruthy();
  });

  it.each(['EmailRow', 'LetterEmailLink'])('%s opens a mail draft to the developer', testID => {
    fireEvent.press(screen.getByTestId(testID));

    expect(Linking.openURL).toHaveBeenCalledWith('mailto:dev@shroudwallet.com');
  });
});
