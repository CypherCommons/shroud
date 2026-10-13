import { act, renderHook } from '@testing-library/react-native';

import useTabSwipe, { dragOffset, releaseTarget, shouldClaimSwipe, swipeTarget } from '../../hooks/useTabSwipe';

const WIDTH = 400;

describe('unit - useTabSwipe', () => {
  describe('shouldClaimSwipe', () => {
    it('claims a drag that is clearly sideways', () => {
      expect(shouldClaimSwipe(20, 5)).toBe(true);
      expect(shouldClaimSwipe(-20, -5)).toBe(true);
    });

    it('leaves short drags to the row under the finger', () => {
      expect(shouldClaimSwipe(10, 0)).toBe(false);
      expect(shouldClaimSwipe(-8, 1)).toBe(false);
    });

    it('leaves vertical and diagonal drags to the list', () => {
      expect(shouldClaimSwipe(5, 40)).toBe(false);
      expect(shouldClaimSwipe(30, 20)).toBe(false);
    });
  });

  describe('swipeTarget', () => {
    it('brings in the next tab on a left drag and the previous one on a right drag', () => {
      expect(swipeTarget(0, 2, -50)).toBe(1);
      expect(swipeTarget(1, 2, 50)).toBe(0);
    });

    it('finds nothing past either end, or without a direction', () => {
      expect(swipeTarget(0, 2, 50)).toBeNull();
      expect(swipeTarget(1, 2, -50)).toBeNull();
      expect(swipeTarget(0, 2, 0)).toBeNull();
    });
  });

  describe('dragOffset', () => {
    it('follows the finger toward a neighbouring tab', () => {
      expect(dragOffset(0, 2, -120)).toBe(-120);
    });

    it('holds back toward a tab that does not exist', () => {
      expect(dragOffset(0, 2, 120)).toBe(30);
      expect(dragOffset(1, 2, -120)).toBe(-30);
    });
  });

  describe('releaseTarget', () => {
    const release = (index: number, dx: number, vx: number) => releaseTarget({ index, count: 2, dx, vx, width: WIDTH });

    it('changes tab once a slow drag has covered enough of the width', () => {
      expect(release(0, -WIDTH * 0.35, -0.1)).toBe(1);
      expect(release(1, WIDTH * 0.35, 0.1)).toBe(0);
    });

    it('stays when a slow drag stops short', () => {
      expect(release(0, -WIDTH * 0.25, -0.1)).toBe(0);
    });

    it('changes tab on a short flick', () => {
      expect(release(0, -40, -0.8)).toBe(1);
      expect(release(1, 40, 0.8)).toBe(0);
    });

    it('stays when the finger flicks back the way it came', () => {
      expect(release(0, -WIDTH * 0.6, 0.8)).toBe(0);
    });

    it('stays at either end however far or fast the drag', () => {
      expect(release(0, WIDTH, 2)).toBe(0);
      expect(release(1, -WIDTH, -2)).toBe(1);
    });
  });

  describe('select', () => {
    const renderTabs = (enabled = true) => {
      const onChange = jest.fn();
      const hook = renderHook(({ index }: { index: number }) => useTabSwipe({ index, count: 2, onChange, enabled }), {
        initialProps: { index: 0 },
      });
      return { ...hook, onChange };
    };

    it('switches to a tapped tab', () => {
      const { result, onChange } = renderTabs();
      act(() => result.current.select(1));
      expect(onChange).toHaveBeenCalledWith(1);
    });

    it('ignores a tap on the tab already shown', () => {
      const { result, onChange } = renderTabs();
      act(() => result.current.select(0));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('still switches tabs with the animation off', () => {
      const { result, onChange } = renderTabs(false);
      act(() => result.current.select(1));
      expect(onChange).toHaveBeenCalledWith(1);
    });

    // Every row of the list spreads these, so a new identity would re-render them all.
    it('hands out the same handlers, style and select on every render', () => {
      const { result, rerender } = renderTabs();
      const first = result.current;
      rerender({ index: 1 });
      expect(result.current.panHandlers).toBe(first.panHandlers);
      expect(result.current.style).toBe(first.style);
      expect(result.current.select).toBe(first.select);
    });
  });
});
