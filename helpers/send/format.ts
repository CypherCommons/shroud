import BigNumber from 'bignumber.js';

import { BitcoinUnit } from '../../models/bitcoinUnits';
import { satoshiToBTC } from '../../modules/currency';

/** Pure formatting/derivation helpers for the send flow. No React, no I/O. */

/** "0.00000714 BTC · 7 sat/vByte" */
export const formatFeeOptionSubtitle = (btcAmount: string, rate: number, unitLabel: string): string =>
  `${btcAmount} BTC · ${rate} ${unitLabel}`;

export type FeeSpeedTier = 'fast' | 'medium' | 'slow';

/** Which confirmation-speed bucket a sat/vByte rate falls into, given the preset thresholds. */
export const feeSpeedTierForRate = (rate: number, fastestRate: number, mediumRate: number): FeeSpeedTier => {
  if (rate >= fastestRate) return 'fast';
  if (rate >= mediumRate) return 'medium';
  return 'slow';
};

/**
 * Approximates the fee for an arbitrary rate by scaling a known (fee, rate) pair linearly.
 * assumes the same coin selection (vsize) holds across the rate range; good enough
 * for a live preview, upgrade to a real coinselect call if estimates drift noticeably.
 */
export const estimateFeeForRate = (rate: number, knownFee: number, knownRate: number): number =>
  knownRate > 0 ? Math.round((knownFee / knownRate) * rate) : 0;

/** Sum of send amount and fee in sats; NaN inputs are treated as 0. */
export const computeTotalSats = (amountSats: number, feeSats: number): number =>
  (Number.isNaN(amountSats) ? 0 : amountSats) + (Number.isNaN(feeSats) ? 0 : feeSats);

/** True when the amount is unset/zero. 'MAX' is NOT empty. */
export const isAmountEmpty = (amount?: string | number): boolean => {
  if (amount === undefined || amount === null) return true;
  if (amount === 'MAX') return false;
  const n = Number(amount);
  return Number.isNaN(n) || n === 0;
};

/**
 * Strips a raw amount input to the valid character set for the given unit.
 * BTC: digits plus at most one decimal point, up to 8 decimals (whole sats).
 * LOCAL_CURRENCY: the same, up to the currency's own decimals (2 for most, 0 for e.g. JPY). SATS: digits only.
 */
export const sanitizeAmountInput = (text: string, unit: BitcoinUnit, fiatFractionDigits = 2): string => {
  let maxDecimals = 8;
  if (unit === BitcoinUnit.SATS) maxDecimals = 0;
  else if (unit === BitcoinUnit.LOCAL_CURRENCY) maxDecimals = fiatFractionDigits;
  if (maxDecimals === 0) {
    return text.replace(/[^0-9]/g, '');
  }
  const cleaned = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const [intPart, ...rest] = cleaned.split('.');
  return rest.length ? `${intPart}.${rest.join('').slice(0, maxDecimals)}` : intPart;
};

/**
 * A fiat amount the way the amount field shows it: rounded to the currency's decimals, dropping a
 * fraction that is all zeros. '' without an amount, e.g. before a rate has loaded.
 */
export const formatFiatInput = (fiat: BigNumber | undefined, fractionDigits = 2): string => {
  if (!fiat?.isFinite()) return '';
  return fiat.toFixed(fractionDigits).replace(/\.0+$/, '');
};

/** Fiat text exactly as typed, and the amount (in BTC) that typing stored for the recipient. */
export interface FiatDraft {
  text: string;
  amount: string;
}

interface AmountFieldTextInput {
  unit: BitcoinUnit;
  /** What the recipient holds: a BTC amount (a number when it came from a scanned URI), '' or undefined when empty, or 'MAX'. */
  stored: string | number | undefined;
  /** The amount in sats, the full balance when sending max. NaN while the BTC text isn't a number yet. */
  sats: number;
  fiatDraft: FiatDraft | null;
  /** `sats` in fiat at the current rate; undefined until a rate has loaded. */
  fiat: BigNumber | undefined;
  fiatFractionDigits: number;
}

/**
 * The amount field's text in `unit`. A fiat amount shows exactly as typed ("0.", "95.9") while the recipient
 * still holds what that typing stored. Whatever else sets the amount (Max, a scanned or pasted amount, typing in
 * another unit) stores something different, so the fiat text is then restated from sats.
 */
export const amountFieldText = ({ unit, stored, sats, fiatDraft, fiat, fiatFractionDigits }: AmountFieldTextInput): string => {
  if (unit === BitcoinUnit.LOCAL_CURRENCY) {
    if (fiatDraft && stored === fiatDraft.amount) return fiatDraft.text;
    return sats > 0 ? formatFiatInput(fiat, fiatFractionDigits) : '';
  }
  if (stored === BitcoinUnit.MAX) return displayAmountForUnit(satoshiToBTC(sats), sats, unit);
  return displayAmountForUnit(stored ? String(stored) : '', sats, unit);
};

/**
 * Picks the string to display for the active unit, given the canonical BTC
 * string and sats number. Empty canonical amount -> ''. In sats mode, a
 * non-finite sats value renders as '' (never 'NaN').
 */
export const displayAmountForUnit = (amountBtc: string, amountSats: number, unit: BitcoinUnit): string => {
  if (!amountBtc) return '';
  if (unit === BitcoinUnit.SATS) {
    return Number.isFinite(amountSats) ? String(amountSats) : '';
  }
  return amountBtc;
};
