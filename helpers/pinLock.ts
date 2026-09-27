import { sha256 } from '@noble/hashes/sha256';
import Keychain from 'react-native-keychain';
import { randomBytes } from '../class/rng';

export const PIN_LENGTH = 4;

const KEYCHAIN_SERVICE = 'shroud_pin';

interface StoredPin {
  hash: string;
  salt: string;
}

const hashPin = (pin: string, saltHex: string): string => {
  return Buffer.from(sha256(Buffer.from(`${saltHex}:${pin}`, 'utf8'))).toString('hex');
};

// Single reader so "no PIN" means the same thing everywhere: the library resolves `false` when
// there is no entry, but some keystore states (and the jest mock) resolve `null`/`undefined`.
// Keychain errors are rethrown so callers can fail closed.
const readStoredPin = async (): Promise<StoredPin | null> => {
  const credentials = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (!credentials) return null;
  try {
    return JSON.parse(credentials.password);
  } catch {
    return null;
  }
};

export const hasPinSet = async (): Promise<boolean> => {
  return (await readStoredPin()) !== null;
};

export const setPin = async (pin: string): Promise<void> => {
  const salt = (await randomBytes(16)).toString('hex');
  const stored: StoredPin = { hash: hashPin(pin, salt), salt };
  await Keychain.setGenericPassword(KEYCHAIN_SERVICE, JSON.stringify(stored), { service: KEYCHAIN_SERVICE });
  await resetAttempts();
};

const verifyPin = async (pin: string): Promise<boolean> => {
  const stored = await readStoredPin();
  return stored !== null && hashPin(pin, stored.salt) === stored.hash;
};

export const clearPin = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  await resetAttempts();
};

// Wrong-PIN limiting. Kept in the Keychain next to the PIN so restarting the app doesn't reset it.
// Shared by every screen that checks the PIN, so switching screens doesn't either.
const ATTEMPTS_SERVICE = 'shroud_pin_attempts';
const FREE_ATTEMPTS = 5;
const BASE_DELAY_MS = 30 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;
/** Failures after which the lock screens offer to reset the app and restore from the recovery phrase. */
export const RESET_OFFER_AFTER = 10;

export interface AttemptState {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

export interface PinLockout {
  /** Epoch ms until which PIN entry is blocked, or null when it isn't. */
  lockedUntil: number | null;
  canOfferReset: boolean;
}

export type PinAttemptResult = { ok: true } | ({ ok: false } & PinLockout);

const NO_ATTEMPTS: AttemptState = { failures: 0, lockedUntil: 0, lastFailureAt: 0 };

/** Delay before the next try, after `failures` wrong PINs in a row: none for the first few, then doubling up to a cap. */
export const delayAfterFailures = (failures: number): number =>
  failures < FREE_ATTEMPTS ? 0 : Math.min(BASE_DELAY_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_DELAY_MS);

/**
 * If the clock is now earlier than the last failure, it was moved back: restart the remaining delay from
 * now instead of letting a rewound clock stretch it (or a user's clock correction lock them out for long).
 */
export const rebaseForClock = (state: AttemptState, now: number): AttemptState => {
  if (now >= state.lastFailureAt) return state;
  return { ...state, lockedUntil: now + Math.max(0, state.lockedUntil - state.lastFailureAt), lastFailureAt: now };
};

const toLockout = (state: AttemptState, now: number): PinLockout => ({
  lockedUntil: state.lockedUntil > now ? state.lockedUntil : null,
  canOfferReset: state.failures >= RESET_OFFER_AFTER,
});

const readAttempts = async (): Promise<AttemptState> => {
  const credentials = await Keychain.getGenericPassword({ service: ATTEMPTS_SERVICE });
  if (!credentials) return NO_ATTEMPTS;
  try {
    return { ...NO_ATTEMPTS, ...JSON.parse(credentials.password) };
  } catch {
    return NO_ATTEMPTS;
  }
};

const writeAttempts = async (state: AttemptState): Promise<void> => {
  await Keychain.setGenericPassword(ATTEMPTS_SERVICE, JSON.stringify(state), { service: ATTEMPTS_SERVICE });
};

const resetAttempts = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service: ATTEMPTS_SERVICE });
};

/** Current lockout, for a screen to show a countdown before any PIN is typed. */
export const getPinLockout = async (now: number = Date.now()): Promise<PinLockout> => {
  return toLockout(rebaseForClock(await readAttempts(), now), now);
};

/**
 * The only way to check a PIN. While locked out it doesn't check the PIN at all, so waiting out the
 * delay can't be skipped by guessing. Keychain errors are rethrown so callers can fail closed.
 */
export const attemptPin = async (pin: string, now: number = Date.now()): Promise<PinAttemptResult> => {
  const state = rebaseForClock(await readAttempts(), now);
  if (state.lockedUntil > now) return { ok: false, ...toLockout(state, now) };

  if (await verifyPin(pin)) {
    await resetAttempts();
    return { ok: true };
  }

  const failures = state.failures + 1;
  const next: AttemptState = { failures, lockedUntil: now + delayAfterFailures(failures), lastFailureAt: now };
  await writeAttempts(next);
  return { ok: false, ...toLockout(next, now) };
};
