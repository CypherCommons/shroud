import BigNumber from 'bignumber.js';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import Localization, { LocalizedStrings } from 'react-localization';

import { satoshiToLocalCurrency } from '../modules/currency';
import { BitcoinUnit } from '../models/bitcoinUnits';
import enJson from './en.json';

dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

interface ILocalization1 extends LocalizedStrings<typeof enJson> {}

// overriding formatString to only return string
interface ILocalization extends Omit<ILocalization1, 'formatString'> {
  formatString: (...args: Parameters<ILocalization1['formatString']>) => string;
}

const loc: ILocalization = new Localization({ en: enJson }) as ILocalization;

export const transactionTimeToReadable = (time: number | string) => {
  if (time === -1) {
    return 'unknown';
  }
  if (+time < 1000000000000) {
    // converting timestamp to milliseconds timestamp
    // (we dont expect timestamps before September 9, 2001 so this conversion is fine)
    time = +time * 1000;
  }
  if (time === 0) {
    return loc._.never;
  }
  let ret;
  try {
    ret = dayjs(time).fromNow();
  } catch (_) {
    console.warn('incorrect locale set for dayjs');
    return String(time);
  }
  return ret;
};

export const removeTrailingZeros = (value: number | string): string => {
  let ret = value.toString();

  if (ret.indexOf('.') === -1) {
    return ret;
  }
  while ((ret.slice(-1) === '0' || ret.slice(-1) === '.') && ret.indexOf('.') !== -1) {
    ret = ret.substr(0, ret.length - 1);
  }
  return ret;
};

/** Stands in for an amount while amounts are hidden. The same length for every amount, so it gives away nothing. */
export const HIDDEN_AMOUNT = '••••';

/**
 *
 * @param balance {number} Satoshis
 * @param toUnit {string} Value from models/bitcoinUnits.js
 * @param withFormatting {boolean} Works only with `BitcoinUnit.SATS`, makes spaces wetween groups of 000
 * @returns {string}
 */
export function formatBalance(balance: number, toUnit: string, withFormatting = false): string {
  if (toUnit === undefined) {
    return balance + ' ' + loc.units[BitcoinUnit.BTC];
  }
  if (toUnit === BitcoinUnit.BTC) {
    const value = new BigNumber(balance).dividedBy(100000000).toFixed(8);
    return removeTrailingZeros(value) + ' ' + loc.units[BitcoinUnit.BTC];
  } else if (toUnit === BitcoinUnit.SATS) {
    return (withFormatting ? new Intl.NumberFormat().format(balance).toString() : String(balance)) + ' ' + loc.units[BitcoinUnit.SATS];
  } else {
    return satoshiToLocalCurrency(balance);
  }
}

/**
 *
 * @param balance {number} Satoshis
 * @param toUnit {string} Value from models/bitcoinUnits.js, for example `BitcoinUnit.SATS`
 * @param withFormatting {boolean} Works only with `BitcoinUnit.SATS`, makes spaces wetween groups of 000
 * @returns {string}
 */
export function formatBalanceWithoutSuffix(balance = 0, toUnit: string, withFormatting = false): string | number {
  if (toUnit === undefined) {
    return balance;
  }
  if (toUnit === BitcoinUnit.BTC) {
    const value = new BigNumber(balance).dividedBy(100000000).toFixed(8);
    return removeTrailingZeros(value);
  } else if (toUnit === BitcoinUnit.SATS) {
    return withFormatting ? new Intl.NumberFormat().format(balance).toString() : String(balance);
  } else {
    return satoshiToLocalCurrency(balance);
  }
}

/**
 * Should be used when we need a simple string to be put in text input, for example
 *
 * @param  balance {number} Satoshis
 * @param toUnit {string} Value from models/bitcoinUnits.js, for example `BitcoinUnit.SATS`
 * @param withFormatting {boolean} Works only with `BitcoinUnit.SATS`, makes spaces wetween groups of 000
 * @returns {string}
 */
export function formatBalancePlain(balance = 0, toUnit: string, withFormatting = false) {
  const newInputValue = formatBalanceWithoutSuffix(balance, toUnit, withFormatting);
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  return _leaveNumbersAndDots(newInputValue.toString());
}

export function _leaveNumbersAndDots(newInputValue: string) {
  newInputValue = newInputValue.replace(/[^\d.,-]/g, ''); // filtering, leaving only numbers, dots & commas
  if (newInputValue.endsWith('.00') || newInputValue.endsWith(',00')) newInputValue = newInputValue.substring(0, newInputValue.length - 3);

  if (newInputValue[newInputValue.length - 3] === ',') {
    // this is a fractional value, lets replace comma to dot so it represents actual fractional value for normal people
    newInputValue = newInputValue.substring(0, newInputValue.length - 3) + '.' + newInputValue.substring(newInputValue.length - 2);
  }
  newInputValue = newInputValue.replace(/,/gi, '');

  return newInputValue;
}

/**
 * @see https://github.com/BlueWallet/BlueWallet/issues/3466
 */
export function formatStringAddTwoWhiteSpaces(text: string): string {
  return `${text}  `;
}

export default loc;
