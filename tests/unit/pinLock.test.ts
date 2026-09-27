import Keychain from 'react-native-keychain';
import {
  attemptPin,
  clearPin,
  delayAfterFailures,
  getPinLockout,
  hasPinSet,
  rebaseForClock,
  RESET_OFFER_AFTER,
  setPin,
} from '../../helpers/pinLock';

const SECOND = 1000;
const T0 = 1_700_000_000_000;

describe('pinLock', () => {
  // One entry per Keychain service: the PIN and the wrong-attempt counter are stored side by side.
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    (Keychain.setGenericPassword as jest.Mock).mockImplementation(
      async (_username: string, password: string, opts: { service: string }) => {
        store[opts.service] = password;
        return { service: opts.service, storage: 'mock' };
      },
    );
    (Keychain.getGenericPassword as jest.Mock).mockImplementation(async (opts: { service: string }) => {
      if (store[opts.service] === undefined) return false;
      return { username: opts.service, password: store[opts.service], service: opts.service, storage: 'mock' };
    });
    (Keychain.resetGenericPassword as jest.Mock).mockImplementation(async (opts: { service: string }) => {
      delete store[opts.service];
      return true;
    });
  });

  const failTimes = async (n: number, now: number = T0) => {
    for (let i = 0; i < n; i++) await attemptPin('0000', now);
  };

  it('reports no PIN set initially', async () => {
    expect(await hasPinSet()).toBe(false);
  });

  it('sets and accepts a correct PIN', async () => {
    await setPin('1234');
    expect(await hasPinSet()).toBe(true);
    expect(await attemptPin('1234', T0)).toEqual({ ok: true });
  });

  it('rejects an incorrect PIN', async () => {
    await setPin('1234');
    expect((await attemptPin('0000', T0)).ok).toBe(false);
  });

  it('never stores the PIN in plaintext', async () => {
    await setPin('1234');
    expect(store.shroud_pin).toBeDefined();
    expect(store.shroud_pin).not.toContain('1234');
  });

  it.each([null, undefined])('treats a keychain read resolving %p as no PIN set', async value => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(value);
    expect(await hasPinSet()).toBe(false);
    expect((await attemptPin('1234', T0)).ok).toBe(false);
  });

  it('clears a set PIN', async () => {
    await setPin('1234');
    await clearPin();
    expect(await hasPinSet()).toBe(false);
    expect((await attemptPin('1234', T0)).ok).toBe(false);
  });

  describe('wrong-attempt limiting', () => {
    beforeEach(async () => {
      await setPin('1234');
    });

    it('allows the first few wrong PINs without a delay', async () => {
      await failTimes(4);
      expect(await getPinLockout(T0)).toEqual({ lockedUntil: null, canOfferReset: false });
      expect(await attemptPin('1234', T0)).toEqual({ ok: true });
    });

    it('locks out after the fifth wrong PIN, without checking the PIN while locked', async () => {
      await failTimes(5);
      expect(await getPinLockout(T0)).toEqual({ lockedUntil: T0 + 30 * SECOND, canOfferReset: false });

      // The right PIN is refused during the delay, and doesn't add a failure either.
      expect(await attemptPin('1234', T0 + 10 * SECOND)).toEqual({ ok: false, lockedUntil: T0 + 30 * SECOND, canOfferReset: false });
      expect(await attemptPin('1234', T0 + 30 * SECOND)).toEqual({ ok: true });
    });

    it('starts counting from zero again after a correct PIN', async () => {
      await failTimes(5);
      await attemptPin('1234', T0 + 30 * SECOND);
      await failTimes(4, T0 + 31 * SECOND);
      expect(await getPinLockout(T0 + 31 * SECOND)).toEqual({ lockedUntil: null, canOfferReset: false });
    });

    it('keeps the count across restarts, since it lives in the keychain', async () => {
      await failTimes(5);
      expect(JSON.parse(store.shroud_pin_attempts).failures).toBe(5);
    });

    it(`offers a reset after ${RESET_OFFER_AFTER} wrong PINs, but never wipes on its own`, async () => {
      let now = T0;
      for (let i = 0; i < RESET_OFFER_AFTER; i++) {
        await attemptPin('0000', now);
        now += delayAfterFailures(i + 1);
      }
      expect((await getPinLockout(now)).canOfferReset).toBe(true);
      expect(await hasPinSet()).toBe(true);
      expect(await attemptPin('1234', now)).toEqual({ ok: true });
    });

    it('resets the count when a new PIN is set', async () => {
      await failTimes(5);
      await setPin('5678');
      expect(await getPinLockout(T0)).toEqual({ lockedUntil: null, canOfferReset: false });
    });

    it('restarts the remaining delay when the clock is moved back', async () => {
      await failTimes(5);
      const earlier = T0 - 24 * 60 * 60 * SECOND;
      expect(await getPinLockout(earlier)).toEqual({ lockedUntil: earlier + 30 * SECOND, canOfferReset: false });
    });
  });

  describe('delayAfterFailures', () => {
    it('doubles from 30s after the fifth failure and caps at an hour', () => {
      expect(delayAfterFailures(4)).toBe(0);
      expect(delayAfterFailures(5)).toBe(30 * SECOND);
      expect(delayAfterFailures(6)).toBe(60 * SECOND);
      expect(delayAfterFailures(9)).toBe(480 * SECOND);
      expect(delayAfterFailures(20)).toBe(60 * 60 * SECOND);
    });
  });

  describe('rebaseForClock', () => {
    it('leaves the state alone when the clock moved forward', () => {
      const state = { failures: 5, lockedUntil: T0 + 30 * SECOND, lastFailureAt: T0 };
      expect(rebaseForClock(state, T0 + 5 * SECOND)).toBe(state);
    });
  });
});
