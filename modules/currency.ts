import BigNumber from 'bignumber.js';
import DefaultPreference from 'react-native-default-preference';
import * as RNLocalize from 'react-native-localize';

import { FiatUnit, FiatUnitType, getFiatRate } from '../models/fiatUnit';

const PREFERRED_CURRENCY_STORAGE_KEY = 'preferredCurrency';
const PREFERRED_CURRENCY_LOCALE_STORAGE_KEY = 'preferredCurrencyLocale';
const EXCHANGE_RATES_STORAGE_KEY = 'exchangeRates';
const LAST_UPDATED = 'LAST_UPDATED';
export const GROUP_IO_SHROUD = 'group.com.shroudwallet.app';
const BTC_PREFIX = 'BTC_';

export interface CurrencyRate {
  LastUpdated: Date | null;
  Rate: number | string | null;
}

interface ExchangeRates {
  [key: string]: number | boolean | undefined;
  LAST_UPDATED_ERROR: boolean;
}

let preferredFiatCurrency: FiatUnitType = FiatUnit.USD;
let exchangeRates: ExchangeRates = { LAST_UPDATED_ERROR: false };
let lastTimeUpdateExchangeRateWasCalled: number = 0;
let skipUpdateExchangeRate: boolean = false;

let currencyFormatter: Intl.NumberFormat | null = null;
let fractionDigitsCache: { code: string; digits: number } | null = null;

// Screens read the rate during render; these let them re-render when it changes (see hooks/useExchangeRate).
const exchangeRateListeners = new Set<() => void>();

function notifyExchangeRateListeners(): void {
  exchangeRateListeners.forEach(listener => listener());
}

/** Calls `listener` whenever the rate or the preferred currency may have changed. Returns the unsubscribe. */
function subscribeToExchangeRate(listener: () => void): () => void {
  exchangeRateListeners.add(listener);
  return () => {
    exchangeRateListeners.delete(listener);
  };
}

function getCurrencyFormatter(): Intl.NumberFormat {
  if (
    !currencyFormatter ||
    currencyFormatter.resolvedOptions().locale !== preferredFiatCurrency.locale ||
    currencyFormatter.resolvedOptions().currency !== preferredFiatCurrency.endPointKey
  ) {
    currencyFormatter = new Intl.NumberFormat(preferredFiatCurrency.locale, {
      style: 'currency',
      currency: preferredFiatCurrency.endPointKey,
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });
    console.debug('Created new currency formatter for: ', preferredFiatCurrency);
  }
  return currencyFormatter;
}

async function setPreferredCurrency(item: FiatUnitType): Promise<void> {
  await DefaultPreference.setName(GROUP_IO_SHROUD);
  try {
    await DefaultPreference.set(PREFERRED_CURRENCY_STORAGE_KEY, item.endPointKey);
    await DefaultPreference.set(PREFERRED_CURRENCY_LOCALE_STORAGE_KEY, item.locale.replace('-', '_'));
    preferredFiatCurrency = FiatUnit[item.endPointKey];
    currencyFormatter = null; // Remove cached formatter
    console.debug('Preferred currency set to:', item);
    console.debug('Preferred currency locale set to:', item.locale.replace('-', '_'));
    console.debug('Cleared all cached currency formatters');
  } catch (error) {
    console.error('Failed to set preferred currency:', error);
    throw error;
  }
  currencyFormatter = null;
  notifyExchangeRateListeners();
}

async function updateExchangeRate(): Promise<void> {
  if (skipUpdateExchangeRate) return;
  if (Date.now() - lastTimeUpdateExchangeRateWasCalled <= 10000) {
    // simple debounce so there's no race conditions
    return;
  }
  lastTimeUpdateExchangeRateWasCalled = Date.now();

  const lastUpdated = exchangeRates[LAST_UPDATED] as number | undefined;
  if (lastUpdated && Date.now() - lastUpdated <= 30 * 60 * 1000) {
    // not updating too often
    return;
  }
  console.log('updating exchange rate...');

  try {
    const rate = await getFiatRate(preferredFiatCurrency.endPointKey);
    exchangeRates[LAST_UPDATED] = Date.now();
    exchangeRates[BTC_PREFIX + preferredFiatCurrency.endPointKey] = rate;
    exchangeRates.LAST_UPDATED_ERROR = false;
    notifyExchangeRateListeners();

    try {
      const exchangeRatesString = JSON.stringify(exchangeRates);
      await DefaultPreference.setName(GROUP_IO_SHROUD);
      await DefaultPreference.set(EXCHANGE_RATES_STORAGE_KEY, exchangeRatesString);
    } catch (error) {
      await DefaultPreference.clear(EXCHANGE_RATES_STORAGE_KEY);
      exchangeRates = { LAST_UPDATED_ERROR: false };
      notifyExchangeRateListeners();
    }
  } catch (error) {
    try {
      await DefaultPreference.setName(GROUP_IO_SHROUD);
      const ratesValue = await DefaultPreference.get(EXCHANGE_RATES_STORAGE_KEY);
      let ratesString: string | null = null;

      if (typeof ratesValue === 'string') {
        ratesString = ratesValue;
      }

      let rate;
      if (ratesString) {
        try {
          rate = JSON.parse(ratesString);
        } catch (parseError) {
          await DefaultPreference.clear(EXCHANGE_RATES_STORAGE_KEY);
          rate = {};
        }
      } else {
        rate = {};
      }
      rate.LAST_UPDATED_ERROR = true;
      exchangeRates.LAST_UPDATED_ERROR = true;
      await DefaultPreference.set(EXCHANGE_RATES_STORAGE_KEY, JSON.stringify(rate));
    } catch (storageError) {
      exchangeRates = { LAST_UPDATED_ERROR: true };
      notifyExchangeRateListeners();
      throw storageError;
    }
  }
}

async function getPreferredCurrency(): Promise<FiatUnitType> {
  await DefaultPreference.setName(GROUP_IO_SHROUD);
  const preferredCurrencyValue = await DefaultPreference.get(PREFERRED_CURRENCY_STORAGE_KEY);
  let preferredCurrency: string | null = null;

  if (typeof preferredCurrencyValue === 'string') {
    preferredCurrency = preferredCurrencyValue;
  }

  if (preferredCurrency) {
    try {
      if (!FiatUnit[preferredCurrency]) {
        throw new Error('Invalid Fiat Unit');
      }
      preferredFiatCurrency = FiatUnit[preferredCurrency];
    } catch (error) {
      await DefaultPreference.clear(PREFERRED_CURRENCY_STORAGE_KEY);
    }
  }

  if (!preferredFiatCurrency) {
    const deviceCurrencies = RNLocalize.getCurrencies();
    if (deviceCurrencies[0] && FiatUnit[deviceCurrencies[0]]) {
      preferredFiatCurrency = FiatUnit[deviceCurrencies[0]];
    } else {
      preferredFiatCurrency = FiatUnit.USD;
    }
  }

  await DefaultPreference.set(PREFERRED_CURRENCY_LOCALE_STORAGE_KEY, preferredFiatCurrency.locale.replace('-', '_'));
  notifyExchangeRateListeners();
  return preferredFiatCurrency;
}

async function _restoreSavedExchangeRatesFromStorage(): Promise<void> {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    const ratesValue = await DefaultPreference.get(EXCHANGE_RATES_STORAGE_KEY);
    let ratesString: string | null = null;

    if (typeof ratesValue === 'string') {
      ratesString = ratesValue;
    }

    if (ratesString) {
      try {
        const parsedRates = JSON.parse(ratesString);
        // Atomic update to prevent race conditions
        exchangeRates = parsedRates;
      } catch (error) {
        await DefaultPreference.clear(EXCHANGE_RATES_STORAGE_KEY);
        exchangeRates = { LAST_UPDATED_ERROR: false };
        // Add delay before update to prevent rapid consecutive calls
        await new Promise(resolve => setTimeout(resolve, 1000));
        await updateExchangeRate();
      }
    } else {
      exchangeRates = { LAST_UPDATED_ERROR: false };
    }
  } catch (error) {
    exchangeRates = { LAST_UPDATED_ERROR: false };
    await updateExchangeRate();
  }
  notifyExchangeRateListeners();
}

async function _restoreSavedPreferredFiatCurrencyFromStorage(): Promise<void> {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    const storedCurrencyValue = await DefaultPreference.get(PREFERRED_CURRENCY_STORAGE_KEY);
    let storedCurrency: string | null = null;

    if (typeof storedCurrencyValue === 'string') {
      storedCurrency = storedCurrencyValue;
    }

    if (!storedCurrency) throw new Error('No Preferred Fiat selected');

    try {
      if (!FiatUnit[storedCurrency]) {
        throw new Error('Invalid Fiat Unit');
      }
      preferredFiatCurrency = FiatUnit[storedCurrency];
    } catch (error) {
      await DefaultPreference.clear(PREFERRED_CURRENCY_STORAGE_KEY);

      const deviceCurrencies = RNLocalize.getCurrencies();
      if (deviceCurrencies[0] && FiatUnit[deviceCurrencies[0]]) {
        preferredFiatCurrency = FiatUnit[deviceCurrencies[0]];
      } else {
        preferredFiatCurrency = FiatUnit.USD;
      }
    }
  } catch (error) {
    const deviceCurrencies = RNLocalize.getCurrencies();
    if (deviceCurrencies[0] && FiatUnit[deviceCurrencies[0]]) {
      preferredFiatCurrency = FiatUnit[deviceCurrencies[0]];
    } else {
      preferredFiatCurrency = FiatUnit.USD;
    }
  }
  notifyExchangeRateListeners();
}

async function isRateOutdated(): Promise<boolean> {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    const rateValue = await DefaultPreference.get(EXCHANGE_RATES_STORAGE_KEY);
    let rateString: string | null = null;

    if (typeof rateValue === 'string') {
      rateString = rateValue;
    }

    let rate;
    if (rateString) {
      try {
        rate = JSON.parse(rateString);
      } catch (parseError) {
        await DefaultPreference.clear(EXCHANGE_RATES_STORAGE_KEY);
        rate = {};
        await updateExchangeRate();
      }
    } else {
      rate = {};
    }
    return rate.LAST_UPDATED_ERROR || Date.now() - (rate[LAST_UPDATED] || 0) >= 31 * 60 * 1000;
  } catch {
    return true;
  }
}

async function restoreSavedPreferredFiatCurrencyAndExchangeFromStorage(): Promise<void> {
  await _restoreSavedExchangeRatesFromStorage();
  await _restoreSavedPreferredFiatCurrencyFromStorage();
}

async function initCurrencyDaemon(clearLastUpdatedTime: boolean = false): Promise<void> {
  await _restoreSavedExchangeRatesFromStorage();
  await _restoreSavedPreferredFiatCurrencyFromStorage();

  if (clearLastUpdatedTime) {
    exchangeRates[LAST_UPDATED] = 0;
    lastTimeUpdateExchangeRateWasCalled = 0;
  }

  await updateExchangeRate();
}

function satoshiToLocalCurrency(satoshi: number, format: boolean = true): string {
  const exchangeRateKey = BTC_PREFIX + preferredFiatCurrency.endPointKey;
  const exchangeRate = exchangeRates[exchangeRateKey];

  if (typeof exchangeRate !== 'number') {
    updateExchangeRate();
    return '...';
  }

  const btcAmount = new BigNumber(satoshi).dividedBy(100000000);
  const convertedAmount = btcAmount.multipliedBy(exchangeRate);
  let formattedAmount: string;

  if (convertedAmount.isGreaterThanOrEqualTo(0.005) || convertedAmount.isLessThanOrEqualTo(-0.005)) {
    formattedAmount = convertedAmount.toFixed(2);
  } else {
    formattedAmount = convertedAmount.toPrecision(2);
  }

  if (format === false) return formattedAmount;

  try {
    return getCurrencyFormatter().format(Number(formattedAmount));
  } catch (error) {
    console.error(error);
    return formattedAmount;
  }
}

function BTCToLocalCurrency(bitcoin: BigNumber.Value): string {
  const sat = new BigNumber(bitcoin).multipliedBy(100000000).toNumber();
  return satoshiToLocalCurrency(sat);
}

async function mostRecentFetchedRate(): Promise<CurrencyRate> {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    const currencyInfoValue = await DefaultPreference.get(EXCHANGE_RATES_STORAGE_KEY);
    let currencyInformationString: string | null = null;

    if (typeof currencyInfoValue === 'string') {
      currencyInformationString = currencyInfoValue;
    }

    let currencyInformation;
    if (currencyInformationString) {
      try {
        currencyInformation = JSON.parse(currencyInformationString);
      } catch (parseError) {
        await DefaultPreference.clear(EXCHANGE_RATES_STORAGE_KEY);
        currencyInformation = {};
        await updateExchangeRate();
      }
    } else {
      currencyInformation = {};
    }

    const rate = currencyInformation[BTC_PREFIX + preferredFiatCurrency.endPointKey];
    return {
      LastUpdated: currencyInformation[LAST_UPDATED] ? new Date(currencyInformation[LAST_UPDATED]) : null,
      Rate: rate ? getCurrencyFormatter().format(rate) : '...',
    };
  } catch {
    return {
      LastUpdated: null,
      Rate: null,
    };
  }
}

function satoshiToBTC(satoshi: number): string {
  return new BigNumber(satoshi).dividedBy(100000000).toString(10);
}

function btcToSatoshi(btc: BigNumber.Value): number {
  return new BigNumber(btc).multipliedBy(100000000).toNumber();
}

function fiatToBTC(fiatFloat: number): string {
  const exchangeRateKey = BTC_PREFIX + preferredFiatCurrency.endPointKey;
  const exchangeRate = exchangeRates[exchangeRateKey];

  if (typeof exchangeRate !== 'number') {
    throw new Error('Exchange rate not available');
  }

  const btcAmount = new BigNumber(fiatFloat).dividedBy(exchangeRate);
  return btcAmount.toFixed(8);
}

function getCurrencySymbol(): string {
  return preferredFiatCurrency.symbol;
}

function getCurrencyCode(): string {
  return preferredFiatCurrency.endPointKey;
}

/** How many decimals the preferred currency is written with: 2 for most, 0 for e.g. JPY, 3 for e.g. KWD. */
function getCurrencyFractionDigits(): number {
  const code = preferredFiatCurrency.endPointKey;
  if (fractionDigitsCache?.code !== code) {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch (_) {}
    fractionDigitsCache = { code, digits };
  }
  return fractionDigitsCache.digits;
}

/** The price of 1 BTC in the preferred currency, or undefined until a rate has loaded. */
function getExchangeRate(): number | undefined {
  const rate = exchangeRates[BTC_PREFIX + preferredFiatCurrency.endPointKey];
  return typeof rate === 'number' ? rate : undefined;
}

/** `satoshi` in the preferred currency, unrounded; undefined until a rate has loaded. */
function satoshiToFiat(satoshi: number): BigNumber | undefined {
  const rate = getExchangeRate();
  return rate === undefined ? undefined : new BigNumber(satoshi).dividedBy(100000000).multipliedBy(rate);
}

/** A fiat amount in whole sats, rounded half up; 0 without a rate, or when `fiat` isn't a positive number. */
function fiatToSatoshi(fiat: BigNumber.Value): number {
  const rate = getExchangeRate();
  const value = new BigNumber(fiat);
  if (rate === undefined || !value.isGreaterThan(0)) return 0;
  return value.dividedBy(rate).multipliedBy(100000000).integerValue(BigNumber.ROUND_HALF_UP).toNumber();
}

function _setPreferredFiatCurrency(currency: FiatUnitType): void {
  preferredFiatCurrency = currency;
  notifyExchangeRateListeners();
}

function _setExchangeRate(pair: string, rate: number): void {
  exchangeRates[pair] = rate;
  notifyExchangeRateListeners();
}

function _setSkipUpdateExchangeRate(): void {
  skipUpdateExchangeRate = true;
}

export {
  _setExchangeRate,
  _setPreferredFiatCurrency,
  _setSkipUpdateExchangeRate,
  BTCToLocalCurrency,
  btcToSatoshi,
  EXCHANGE_RATES_STORAGE_KEY,
  fiatToBTC,
  fiatToSatoshi,
  getCurrencyCode,
  getCurrencyFractionDigits,
  getCurrencySymbol,
  getExchangeRate,
  getPreferredCurrency,
  initCurrencyDaemon,
  isRateOutdated,
  LAST_UPDATED,
  mostRecentFetchedRate,
  PREFERRED_CURRENCY_STORAGE_KEY,
  restoreSavedPreferredFiatCurrencyAndExchangeFromStorage,
  satoshiToBTC,
  satoshiToFiat,
  satoshiToLocalCurrency,
  setPreferredCurrency,
  subscribeToExchangeRate,
  updateExchangeRate,
};
