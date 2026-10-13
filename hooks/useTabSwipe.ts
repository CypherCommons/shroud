import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, GestureResponderHandlers, PanResponder, useWindowDimensions } from 'react-native';

import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';

// Sideways travel, and how much it has to beat vertical travel by, before a drag counts as a swipe.
// Below that the touch still belongs to the row under the finger and to the list's own scrolling.
const CLAIM_SLOP = 10;
// Share of the width a drag must cover to change tab when the finger lifts without a flick.
const COMMIT_DISTANCE = 0.3;
// A flick this fast (px/ms) changes tab however short the drag was.
const COMMIT_VELOCITY = 0.5;
// Dragged toward a tab that doesn't exist, the content gives a little and springs back.
const EDGE_RESISTANCE = 0.25;
const EXIT_MS = 160;
const ENTER_MS = 220;

export const shouldClaimSwipe = (dx: number, dy: number) => Math.abs(dx) > CLAIM_SLOP && Math.abs(dx) > 2 * Math.abs(dy);

/** The tab a sideways drag reaches for: dragging left brings in the next one. Null past either end. */
export const swipeTarget = (index: number, count: number, dx: number): number | null => {
  if (dx === 0) return null;
  const target = dx < 0 ? index + 1 : index - 1;
  return target >= 0 && target < count ? target : null;
};

/** Where the content sits under the finger: with it toward a neighbouring tab, held back toward none. */
export const dragOffset = (index: number, count: number, dx: number) =>
  swipeTarget(index, count, dx) === null ? dx * EDGE_RESISTANCE : dx;

/** The tab to settle on once the finger lifts. */
export const releaseTarget = ({ index, count, dx, vx, width }: { index: number; count: number; dx: number; vx: number; width: number }) => {
  const target = swipeTarget(index, count, dx);
  if (target === null) return index;
  if (Math.abs(vx) > COMMIT_VELOCITY) {
    // A flick back the way the drag came cancels it, however far it got.
    return Math.sign(vx) === Math.sign(dx) ? target : index;
  }
  return Math.abs(dx) > width * COMMIT_DISTANCE ? target : index;
};

interface UseTabSwipeOptions {
  index: number;
  count: number;
  /** Must move `index` to the tab given: the content slides in once that tab has rendered. */
  onChange: (index: number) => void;
  enabled?: boolean;
  /** True from the moment a swipe takes the touch until it lets go, so the screen can hold its list still. */
  onSwipingChange?: (swiping: boolean) => void;
}

type Phase = 'idle' | 'dragging' | 'exiting' | 'entering';

// Lets the user swipe between tabs whose content shares one vertical list, so a pager can't hold
// each tab on a page of its own. Every view of the tab's content takes `panHandlers` and `style`:
// they follow the finger, and a committed swipe slides them out, switches the tab, and slides the
// new tab's content in from the side the finger came from. Tab taps go through `select` and get
// the same entrance.
const useTabSwipe = ({ index, count, onChange, enabled = true, onSwipingChange }: UseTabSwipeOptions) => {
  const { width } = useWindowDimensions();
  // Native from the start: a JS-driven value would push every move of the first drag through
  // every wrapped row from JS.
  const [x] = useState(() => new Animated.Value(0, { useNativeDriver: true }));
  const live = useRef({ index, count, width, enabled, onChange, onSwipingChange });
  const phase = useRef<Phase>('idle');
  // Bumped by each animation, so one that was cut short can tell it's been superseded.
  const generation = useRef(0);
  // Where the next tab's content enters from; set just before `onChange`.
  const enterFrom = useRef<number | null>(null);
  const shownIndex = useRef(index);
  // How far the finger had already moved when the swipe took the touch.
  const grantDx = useRef(0);
  // Set for a swipe that began while the old tab was sliding out; it moves nothing.
  const ignoring = useRef(false);

  useLayoutEffect(() => {
    live.current = { index, count, width, enabled, onChange, onSwipingChange };
  });

  // A layout effect, so the new content is already rendered (off to the side) before it moves:
  // starting from `onChange` instead would slide the old tab's rows back in for a frame or two.
  useLayoutEffect(() => {
    if (index === shownIndex.current) return;
    const from = enterFrom.current ?? Math.sign(index - shownIndex.current) * width;
    shownIndex.current = index;
    enterFrom.current = null;
    const token = ++generation.current;
    if (!enabled) {
      x.setValue(0);
      phase.current = 'idle';
      return;
    }
    phase.current = 'entering';
    x.setValue(from);
    Animated.timing(x, { toValue: 0, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => {
        if (token !== generation.current) return;
        if (!finished) x.setValue(0);
        phase.current = 'idle';
      },
    );
  }, [index, enabled, width, x]);

  const [panHandlers] = useState<GestureResponderHandlers>(() => {
    const settle = (dx: number, vx: number) => {
      const { index: current, count: tabs, width: pageWidth, onChange: change, onSwipingChange: swiping } = live.current;
      swiping?.(false);
      if (ignoring.current) {
        ignoring.current = false;
        return;
      }
      const next = releaseTarget({ index: current, count: tabs, dx, vx, width: pageWidth });
      const token = ++generation.current;
      if (next === current) {
        phase.current = 'idle';
        Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
        return;
      }
      triggerHapticFeedback(HapticFeedbackTypes.Selection);
      phase.current = 'exiting';
      // Leaving toward the next tab means leaving to the left, so it enters from the right.
      const side = next > current ? 1 : -1;
      Animated.timing(x, { toValue: -side * pageWidth, duration: EXIT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(
        ({ finished }) => {
          if (token !== generation.current) return;
          if (!finished) {
            x.setValue(0);
            phase.current = 'idle';
            return;
          }
          enterFrom.current = side * pageWidth;
          change(next);
        },
      );
    };

    return PanResponder.create({
      // Claimed even mid-transition: a swipe left to the row under it would end as a tap on that row.
      onMoveShouldSetPanResponder: (_, g) => live.current.enabled && g.numberActiveTouches === 1 && shouldClaimSwipe(g.dx, g.dy),
      onPanResponderGrant: (_, g) => {
        live.current.onSwipingChange?.(true);
        // The tab is already on its way out, so this swipe is held and then dropped.
        if (phase.current === 'exiting') {
          ignoring.current = true;
          return;
        }
        // Takes over from an entrance still running, or a spring back still settling.
        ++generation.current;
        x.stopAnimation();
        phase.current = 'dragging';
        grantDx.current = g.dx;
      },
      onPanResponderMove: (_, g) => {
        if (ignoring.current) return;
        x.setValue(dragOffset(live.current.index, live.current.count, g.dx - grantDx.current));
      },
      // The list asks for the touch as soon as it scrolls. Holding on to it, while the screen
      // stops the scrolling, keeps a swipe that drifts vertically a swipe.
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, g) => settle(g.dx - grantDx.current, g.vx),
      onPanResponderTerminate: () => settle(0, 0),
    }).panHandlers;
  });

  const style = useMemo(
    () => ({
      opacity: x.interpolate({ inputRange: [-width, 0, width], outputRange: [0, 1, 0], extrapolate: 'clamp' }),
      transform: [{ translateX: x }],
    }),
    [x, width],
  );

  const [select] = useState(() => (next: number) => {
    const { index: current, width: pageWidth, enabled: animate, onChange: change } = live.current;
    if (next === current || phase.current === 'dragging' || phase.current === 'exiting') return;
    if (animate) {
      // Moved off to the side before the new tab renders, so its rows never show in place first.
      ++generation.current;
      enterFrom.current = (next > current ? 1 : -1) * pageWidth;
      x.setValue(enterFrom.current);
    }
    change(next);
  });

  return { panHandlers, style, select };
};

export default useTabSwipe;
