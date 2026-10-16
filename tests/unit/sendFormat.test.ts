import BigNumber from 'bignumber.js';

import {
  amountFieldText,
  formatFeeOptionSubtitle,
  computeTotalSats,
  isAmountEmpty,
  sanitizeAmountInput,
  displayAmountForUnit,
  feeSpeedTierForRate,
  estimateFeeForRate,
  formatFiatInput,
} from '../../helpers/send/format';
import { BitcoinUnit } from '../../models/bitcoinUnits';

describe('send/format', () => {
  describe('formatFeeOptionSubtitle', () => {
    it('composes the btc amount, rate and unit', () => {
      expect(formatFeeOptionSubtitle('0.00000714', 7, 'sat/vByte')).toBe('0.00000714 BTC · 7 sat/vByte');
    });
  });

  describe('computeTotalSats', () => {
    it('adds amount and fee', () => {
      expect(computeTotalSats(4000, 511)).toBe(4511);
    });
    it('treats NaN inputs as zero', () => {
      expect(computeTotalSats(NaN, 511)).toBe(511);
      expect(computeTotalSats(4000, NaN)).toBe(4000);
    });
  });

  describe('isAmountEmpty', () => {
    it('is true for undefined, empty, zero, and non-numeric strings', () => {
      expect(isAmountEmpty(undefined)).toBe(true);
      expect(isAmountEmpty('')).toBe(true);
      expect(isAmountEmpty('0')).toBe(true);
      expect(isAmountEmpty(0)).toBe(true);
      expect(isAmountEmpty('.')).toBe(true);
      expect(isAmountEmpty(',')).toBe(true);
    });
    it('is false for a positive amount and for MAX', () => {
      expect(isAmountEmpty('0.0001')).toBe(false);
      expect(isAmountEmpty('MAX')).toBe(false);
    });
  });

  describe('sanitizeAmountInput', () => {
    it('keeps digits and a single dot in BTC mode, dropping extras', () => {
      expect(sanitizeAmountInput('0.0000344', BitcoinUnit.BTC)).toBe('0.0000344');
      expect(sanitizeAmountInput('abc1.2.3', BitcoinUnit.BTC)).toBe('1.23');
      expect(sanitizeAmountInput('1,000.5', BitcoinUnit.BTC)).toBe('1.0005');
      expect(sanitizeAmountInput('1.2.3.4', BitcoinUnit.BTC)).toBe('1.234');
    });
    it('keeps digits only in sats mode, dropping dots and separators', () => {
      expect(sanitizeAmountInput('3440', BitcoinUnit.SATS)).toBe('3440');
      expect(sanitizeAmountInput('3,440 sats', BitcoinUnit.SATS)).toBe('3440');
      expect(sanitizeAmountInput('0.5', BitcoinUnit.SATS)).toBe('05');
    });
    it('returns empty string for empty input in either unit', () => {
      expect(sanitizeAmountInput('', BitcoinUnit.BTC)).toBe('');
      expect(sanitizeAmountInput('', BitcoinUnit.SATS)).toBe('');
    });
    it('stops BTC at 8 decimals, so an amount is always whole sats', () => {
      expect(sanitizeAmountInput('0.000012345', BitcoinUnit.BTC)).toBe('0.00001234');
      expect(sanitizeAmountInput('0.00000001', BitcoinUnit.BTC)).toBe('0.00000001');
    });
    it('keeps digits and a single dot in local currency, stopping at 2 decimals by default', () => {
      expect(sanitizeAmountInput('95.987', BitcoinUnit.LOCAL_CURRENCY)).toBe('95.98');
      expect(sanitizeAmountInput('1,5', BitcoinUnit.LOCAL_CURRENCY)).toBe('1.5');
      expect(sanitizeAmountInput('₹100', BitcoinUnit.LOCAL_CURRENCY)).toBe('100');
      expect(sanitizeAmountInput('0.', BitcoinUnit.LOCAL_CURRENCY)).toBe('0.');
    });
    it("follows the currency's own decimals", () => {
      expect(sanitizeAmountInput('1500.5', BitcoinUnit.LOCAL_CURRENCY, 0)).toBe('15005');
      expect(sanitizeAmountInput('1,500', BitcoinUnit.LOCAL_CURRENCY, 0)).toBe('1500');
      expect(sanitizeAmountInput('1.2345', BitcoinUnit.LOCAL_CURRENCY, 3)).toBe('1.234');
    });
  });

  describe('formatFiatInput', () => {
    it('keeps cents and drops them from whole amounts', () => {
      expect(formatFiatInput(new BigNumber('95.98'))).toBe('95.98');
      expect(formatFiatInput(new BigNumber('95.9'))).toBe('95.90');
      expect(formatFiatInput(new BigNumber('7778'))).toBe('7778');
    });
    it('rounds half up to the currency decimals', () => {
      expect(formatFiatInput(new BigNumber('95.985'))).toBe('95.99');
      expect(formatFiatInput(new BigNumber('15000.6'), 0)).toBe('15001');
      expect(formatFiatInput(new BigNumber('1.5'), 3)).toBe('1.500');
      expect(formatFiatInput(new BigNumber('2.0001'), 3)).toBe('2');
    });
    it('rounds an amount below the smallest unit to 0', () => {
      expect(formatFiatInput(new BigNumber('0.0011'))).toBe('0');
    });
    it('returns empty string without an amount, as before a rate has loaded', () => {
      expect(formatFiatInput(undefined)).toBe('');
      expect(formatFiatInput(new BigNumber(NaN))).toBe('');
    });
  });

  describe('amountFieldText', () => {
    const base = { sats: 1234, fiatDraft: null, fiat: new BigNumber('123.4'), fiatFractionDigits: 2 };

    it('restates the stored amount in bitcoin units', () => {
      expect(amountFieldText({ ...base, unit: BitcoinUnit.SATS, stored: '0.00001234' })).toBe('1234');
      expect(amountFieldText({ ...base, unit: BitcoinUnit.BTC, stored: '0.00001234' })).toBe('0.00001234');
      expect(amountFieldText({ ...base, unit: BitcoinUnit.BTC, stored: undefined, sats: NaN })).toBe('');
    });
    it('shows Max as the whole balance it stands for', () => {
      const max = { ...base, stored: BitcoinUnit.MAX, sats: 7106, fiat: new BigNumber('554.66') };
      expect(amountFieldText({ ...max, unit: BitcoinUnit.SATS })).toBe('7106');
      expect(amountFieldText({ ...max, unit: BitcoinUnit.BTC })).toBe('0.00007106');
      expect(amountFieldText({ ...max, unit: BitcoinUnit.LOCAL_CURRENCY })).toBe('554.66');
    });
    it('keeps fiat as typed while the recipient still holds what that typing stored', () => {
      const fiatDraft = { text: '95.9', amount: '0.00000959' };
      expect(amountFieldText({ ...base, unit: BitcoinUnit.LOCAL_CURRENCY, stored: '0.00000959', sats: 959, fiatDraft })).toBe('95.9');
      expect(
        amountFieldText({ ...base, unit: BitcoinUnit.LOCAL_CURRENCY, stored: '0', sats: 0, fiatDraft: { text: '0.', amount: '0' } }),
      ).toBe('0.');
    });
    it('restates fiat from sats once something else replaced the amount, even with the same sats', () => {
      const fiatDraft = { text: '0.', amount: '0' };
      // a scanned URI stores a number, Max off stores '', and both mean 0 sats like the draft did
      expect(amountFieldText({ ...base, unit: BitcoinUnit.LOCAL_CURRENCY, stored: 0, sats: 0, fiatDraft })).toBe('');
      expect(amountFieldText({ ...base, unit: BitcoinUnit.LOCAL_CURRENCY, stored: '', sats: 0, fiatDraft })).toBe('');
      expect(amountFieldText({ ...base, unit: BitcoinUnit.LOCAL_CURRENCY, stored: '0.00001234', fiatDraft })).toBe('123.40');
    });
    it('leaves fiat empty before a rate has loaded', () => {
      expect(amountFieldText({ ...base, unit: BitcoinUnit.LOCAL_CURRENCY, stored: '0.00001234', fiat: undefined })).toBe('');
    });
  });

  describe('displayAmountForUnit', () => {
    it('shows the BTC string in BTC mode', () => {
      expect(displayAmountForUnit('0.0000344', 3440, BitcoinUnit.BTC)).toBe('0.0000344');
    });
    it('shows the integer sats string in sats mode', () => {
      expect(displayAmountForUnit('0.0000344', 3440, BitcoinUnit.SATS)).toBe('3440');
    });
    it('returns empty string when the amount is empty, in either unit', () => {
      expect(displayAmountForUnit('', 0, BitcoinUnit.BTC)).toBe('');
      expect(displayAmountForUnit('', 0, BitcoinUnit.SATS)).toBe('');
    });
    it('preserves in-progress BTC typing like "0."', () => {
      expect(displayAmountForUnit('0.', 0, BitcoinUnit.BTC)).toBe('0.');
    });
    it('returns empty string in sats mode when sats is not finite', () => {
      expect(displayAmountForUnit('.', NaN, BitcoinUnit.SATS)).toBe('');
    });
  });

  describe('feeSpeedTierForRate', () => {
    it('picks fast at or above the fastest preset rate', () => {
      expect(feeSpeedTierForRate(8, 8, 5)).toBe('fast');
      expect(feeSpeedTierForRate(20, 8, 5)).toBe('fast');
    });
    it('picks medium between the medium and fastest preset rates', () => {
      expect(feeSpeedTierForRate(5, 8, 5)).toBe('medium');
      expect(feeSpeedTierForRate(7, 8, 5)).toBe('medium');
    });
    it('picks slow below the medium preset rate', () => {
      expect(feeSpeedTierForRate(1, 8, 5)).toBe('slow');
    });
  });

  describe('estimateFeeForRate', () => {
    it('scales a known fee/rate pair linearly to a new rate', () => {
      expect(estimateFeeForRate(4, 1024, 8)).toBe(512);
    });
    it('returns 0 when the known rate is 0 (avoids divide-by-zero)', () => {
      expect(estimateFeeForRate(4, 1024, 0)).toBe(0);
    });
  });
});
