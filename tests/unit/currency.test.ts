import assert from 'assert';

import {
  _setExchangeRate,
  _setPreferredFiatCurrency,
  BTCToLocalCurrency,
  fiatToSatoshi,
  getCurrencyCode,
  getCurrencyFractionDigits,
  getExchangeRate,
  satoshiToBTC,
  satoshiToFiat,
  satoshiToLocalCurrency,
  subscribeToExchangeRate,
} from '../../modules/currency';
import { FiatUnit } from '../../models/fiatUnit';

describe('currency', () => {
  it('formats everything correctly', async () => {
    _setExchangeRate('BTC_USD', 10000);

    assert.strictEqual(satoshiToLocalCurrency(1), '$0.0001');
    assert.strictEqual(satoshiToLocalCurrency(-1), '-$0.0001');
    assert.strictEqual(satoshiToLocalCurrency(123), '$0.01');
    assert.strictEqual(satoshiToLocalCurrency(156), '$0.02');
    assert.strictEqual(satoshiToLocalCurrency(51), '$0.01');
    assert.strictEqual(satoshiToLocalCurrency(45), '$0.0045');
    assert.strictEqual(satoshiToLocalCurrency(123456789), '$12,345.68');

    assert.strictEqual(BTCToLocalCurrency(1), '$10,000.00');
    assert.strictEqual(BTCToLocalCurrency(-1), '-$10,000.00');
    assert.strictEqual(BTCToLocalCurrency(1.00000001), '$10,000.00');
    assert.strictEqual(BTCToLocalCurrency(1.0000123), '$10,000.12');
    assert.strictEqual(BTCToLocalCurrency(1.0000146), '$10,000.15');

    assert.strictEqual(satoshiToBTC(1), '0.00000001');
    assert.strictEqual(satoshiToBTC(-1), '-0.00000001');
    assert.strictEqual(satoshiToBTC(100000000), '1');
    assert.strictEqual(satoshiToBTC(123456789123456789), '1234567891.2345678'); // eslint-disable-line no-loss-of-precision

    _setPreferredFiatCurrency(FiatUnit.JPY);
    _setExchangeRate('BTC_JPY', 1043740.8614);

    assert.ok(satoshiToLocalCurrency(1) === '¥0.01' || satoshiToLocalCurrency(1) === '￥0.01', 'Unexpected: ' + satoshiToLocalCurrency(1));
  });

  it('converts between sats and the preferred currency', () => {
    _setPreferredFiatCurrency(FiatUnit.INR);
    _setExchangeRate('BTC_INR', 10_000_000);

    assert.strictEqual(getCurrencyCode(), 'INR');
    assert.strictEqual(getExchangeRate(), 10_000_000);
    assert.strictEqual(satoshiToFiat(1234)?.toString(), '123.4');
    assert.strictEqual(fiatToSatoshi('123.4'), 1234);
    // to whole sats, half up: 0.05 INR is 0.5 sat
    assert.strictEqual(fiatToSatoshi('0.05'), 1);
    assert.strictEqual(fiatToSatoshi('0.04'), 0);
    assert.strictEqual(fiatToSatoshi(''), 0);
    assert.strictEqual(fiatToSatoshi('.'), 0);
    assert.strictEqual(fiatToSatoshi('-5'), 0);
  });

  it('has no rate, and converts nothing, for a currency whose rate has not loaded', () => {
    _setPreferredFiatCurrency(FiatUnit.EUR);

    assert.strictEqual(getExchangeRate(), undefined);
    assert.strictEqual(satoshiToFiat(1234), undefined);
    assert.strictEqual(fiatToSatoshi('100'), 0);
  });

  it("knows each currency's decimals", () => {
    _setPreferredFiatCurrency(FiatUnit.USD);
    assert.strictEqual(getCurrencyFractionDigits(), 2);
    _setPreferredFiatCurrency(FiatUnit.JPY);
    assert.strictEqual(getCurrencyFractionDigits(), 0);
    _setPreferredFiatCurrency(FiatUnit.KWD);
    assert.strictEqual(getCurrencyFractionDigits(), 3);
  });

  it('tells subscribers when the rate or the currency changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToExchangeRate(listener);

    _setExchangeRate('BTC_USD', 20000);
    _setPreferredFiatCurrency(FiatUnit.USD);
    assert.strictEqual(listener.mock.calls.length, 2);

    unsubscribe();
    _setExchangeRate('BTC_USD', 30000);
    assert.strictEqual(listener.mock.calls.length, 2);
  });
});
