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
  /** Lockout time still to serve. */
  remainingMs: number;
  /** Monotonic time of the last check, only meaningful within `session`. */
  checkedAt: number;
  session: string;
}

export interface PinLockout {
  /** Ms until PIN entry is allowed again, or null when it isn't blocked. */
  retryInMs: number | null;
  canOfferReset: boolean;
}

export type PinAttemptResult = { ok: true } | ({ ok: false } & PinLockout);

// Identifies this app process. performance.now() restarts from zero in every process, so a checkedAt
// from another session can't be compared against it.
const SESSION = `${Date.now()}-${Math.random()}`;

const monotonicNow = (): number => performance.now();

const NO_ATTEMPTS: AttemptState = { failures: 0, remainingMs: 0, checkedAt: 0, session: '' };

/** Delay before the next try, after `failures` wrong PINs in a row: none for the first few, then doubling up to a cap. */
export const delayAfterFailures = (failures: number): number =>
  failures < FREE_ATTEMPTS ? 0 : Math.min(BASE_DELAY_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_DELAY_MS);

/**
 * Takes the time that passed since the last check off the lockout. Only a monotonic clock in the same
 * process counts, so changing the device clock can't shorten it. Time while the app isn't running
 * doesn't count either: after a restart the rest of the delay has to be waited out in the app.
 */
export const creditElapsed = (state: AttemptState, now: number, session: string = SESSION): AttemptState => {
  const elapsed = state.session === session ? Math.max(0, now - state.checkedAt) : 0;
  return { ...state, remainingMs: Math.max(0, state.remainingMs - elapsed), checkedAt: now, session };
};

const toLockout = (state: AttemptState): PinLockout => ({
  retryInMs: state.remainingMs > 0 ? state.remainingMs : null,
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

// Reads the attempt state with elapsed time credited, saving the credit so a restart doesn't lose it.
const readCreditedAttempts = async (now: number): Promise<AttemptState> => {
  const stored = await readAttempts();
  const state = creditElapsed(stored, now);
  if (stored.remainingMs > 0) await writeAttempts(state);
  return state;
};

/** Current lockout, for a screen to show a countdown before any PIN is typed. */
export const getPinLockout = async (now: number = monotonicNow()): Promise<PinLockout> => {
  return toLockout(await readCreditedAttempts(now));
};

/**
 * The only way to check a PIN. While locked out it doesn't check the PIN at all, so waiting out the
 * delay can't be skipped by guessing. Keychain errors are rethrown so callers can fail closed.
 */
export const attemptPin = async (pin: string, now: number = monotonicNow()): Promise<PinAttemptResult> => {
  const state = await readCreditedAttempts(now);
  if (state.remainingMs > 0) return { ok: false, ...toLockout(state) };

  if (await verifyPin(pin)) {
    await resetAttempts();
    return { ok: true };
  }

  const failures = state.failures + 1;
  const next: AttemptState = { ...state, failures, remainingMs: delayAfterFailures(failures) };
  await writeAttempts(next);
  return { ok: false, ...toLockout(next) };
};
