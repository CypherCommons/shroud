import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import FiatBalance from '../../components/FiatBalance';
import { FiatUnit } from '../../models/fiatUnit';
import { _setExchangeRate, _setPreferredFiatCurrency, _setSkipUpdateExchangeRate } from '../../modules/currency';

describe('unit - FiatBalance', () => {
  beforeAll(() => _setSkipUpdateExchangeRate()); // no fetching: the test hands it its rates

  it('shows a rate that arrives after it has rendered', () => {
    _setPreferredFiatCurrency(FiatUnit.USD);
    render(<FiatBalance sats={100_000_000} />);
    expect(screen.getByText('≈ ...')).toBeTruthy();

    act(() => _setExchangeRate('BTC_USD', 50_000));

    expect(screen.getByText('≈ $50,000.00')).toBeTruthy();
  });

  it('follows a change of currency', () => {
    _setExchangeRate('BTC_USD', 50_000);
    _setExchangeRate('BTC_EUR', 40_000);
    _setPreferredFiatCurrency(FiatUnit.USD);
    render(<FiatBalance sats={100_000_000} />);

    act(() => _setPreferredFiatCurrency(FiatUnit.EUR));

    expect(screen.queryByText('≈ $50,000.00')).toBeNull();
    expect(screen.getByText(/40[.,]000/)).toBeTruthy();
  });
});
