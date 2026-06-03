import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Coordination flag between the live app and the headless background scan task.
 *
 * In a headless JS context AppState.currentState is always 'background', so the
 * background task cannot tell "app suspended with a live scan" from "no app at
 * all". Instead the live app stamps this flag on every foreground/background
 * transition, and the background task bails when the foreground claim is fresh.
 * The timestamp guards against a stale claim left behind by a crashed app.
 */
const KEY = 'background_scan_foreground_flag';

/**
 * A foreground claim older than this is ignored (crashed app / missed transition).
 * Kept short: the OS already refuses to run background tasks while the app is
 * genuinely foregrounded, so this flag only guards edge timing around transitions.
 */
const FOREGROUND_STALENESS_MS = 5 * 60 * 1000;

interface ForegroundFlag {
  active: boolean;
  ts: number;
}

async function setFlag(active: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ active, ts: Date.now() } satisfies ForegroundFlag));
  } catch (error) {
    console.warn('[BackgroundScan] Failed to write foreground flag:', error);
  }
}

export async function markForegroundActive(): Promise<void> {
  await setFlag(true);
}

export async function markForegroundInactive(): Promise<void> {
  await setFlag(false);
}

export async function isForegroundActive(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return false;

    const flag = JSON.parse(raw) as ForegroundFlag;
    return flag.active && Date.now() - flag.ts < FOREGROUND_STALENESS_MS;
  } catch (error) {
    console.warn('[BackgroundScan] Failed to read foreground flag:', error);
    return false;
  }
}
