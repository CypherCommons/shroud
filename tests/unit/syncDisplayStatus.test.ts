import { act, renderHook } from '@testing-library/react-native';

import type { ScanStatus } from '../../helpers/silent-payments';
import { type SyncDisplayStatus, syncDisplayDelay, useSyncDisplayStatus } from '../../hooks/useSyncDisplayStatus';

describe('syncDisplayDelay', () => {
  const now = { hold: false, targetForMs: 0, shownForMs: 0 };

  it.each<[SyncDisplayStatus, SyncDisplayStatus, typeof now, number | null]>([
    ['done', 'done', now, null],
    ['done', 'scanning', now, 400],
    ['done', 'scanning', { ...now, targetForMs: 250 }, 150],
    ['done', 'scanning', { ...now, targetForMs: 500 }, 0],
    ['error', 'scanning', { ...now, hold: true }, 400],
    ['scanning', 'done', { ...now, shownForMs: 100 }, 700],
    ['scanning', 'done', { ...now, shownForMs: 900 }, 0],
    ['scanning', 'done', { ...now, hold: true, shownForMs: 100 }, 700],
    ['scanning', 'paused', now, 0],
    ['paused', 'scanning', now, 0],
    ['scanning', 'error', now, 0],
    ['paused', 'done', now, 0],
    ['done', 'paused', { ...now, hold: true }, 0],
    ['done', 'error', now, 0],
    ['error', 'done', now, 0],
    ['done', 'error', { ...now, hold: true }, null],
    ['error', 'done', { ...now, hold: true }, null],
  ])('%s → %s with %o waits %s', (shown, target, timing, delay) => {
    expect(syncDisplayDelay(shown, target, timing)).toBe(delay);
  });
});

describe('useSyncDisplayStatus', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const mount = (status: ScanStatus, hold = false) =>
    renderHook((props: { status: ScanStatus; hold: boolean }) => useSyncDisplayStatus(props.status, props.hold), {
      initialProps: { status, hold },
    });

  it('shows the status it opens on straight away', () => {
    expect(mount('scanning').result.current).toEqual({ status: 'scanning', settled: true });
    expect(mount('idle').result.current).toEqual({ status: 'done', settled: true });
  });

  it('never shows a scan that ends within 400ms', () => {
    const { result, rerender } = mount('idle');

    rerender({ status: 'scanning', hold: false });
    act(() => jest.advanceTimersByTime(399));
    expect(result.current.status).toBe('done');

    rerender({ status: 'idle', hold: false });
    act(() => jest.advanceTimersByTime(2000));
    expect(result.current).toEqual({ status: 'done', settled: true });
  });

  it('shows a longer scan at 400ms, and keeps it up for at least 800ms', () => {
    const { result, rerender } = mount('idle');

    rerender({ status: 'scanning', hold: false });
    act(() => jest.advanceTimersByTime(400));
    expect(result.current).toEqual({ status: 'scanning', settled: true });

    // the scan ends 100ms after it appeared
    act(() => jest.advanceTimersByTime(100));
    rerender({ status: 'idle', hold: false });
    act(() => jest.advanceTimersByTime(699));
    expect(result.current).toEqual({ status: 'scanning', settled: false });

    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toEqual({ status: 'done', settled: true });
  });

  it('swaps between scanning and paused in the same render', () => {
    const { result, rerender } = mount('scanning');

    rerender({ status: 'paused', hold: false });
    expect(result.current).toEqual({ status: 'paused', settled: true });

    rerender({ status: 'scanning', hold: false });
    expect(result.current).toEqual({ status: 'scanning', settled: true });
  });

  it('shows an error at once, even during a scan’s minimum time on screen', () => {
    const { result, rerender } = mount('scanning');

    rerender({ status: 'error', hold: false });
    act(() => jest.advanceTimersByTime(0));

    expect(result.current.status).toBe('error');
  });

  it('holds done and error while a check runs, then lands on where it ended', () => {
    const { result, rerender } = mount('error', true);

    rerender({ status: 'idle', hold: true });
    act(() => jest.advanceTimersByTime(5000));
    expect(result.current).toEqual({ status: 'error', settled: false });

    rerender({ status: 'idle', hold: false });
    act(() => jest.advanceTimersByTime(0));
    expect(result.current).toEqual({ status: 'done', settled: true });
  });

  it('keeps counting a pending wait through a change of hold', () => {
    const { result, rerender } = mount('idle', true);

    rerender({ status: 'scanning', hold: true });
    act(() => jest.advanceTimersByTime(200));
    rerender({ status: 'scanning', hold: false });
    act(() => jest.advanceTimersByTime(199));
    expect(result.current.status).toBe('done');

    act(() => jest.advanceTimersByTime(1));
    expect(result.current.status).toBe('scanning');
  });
});
