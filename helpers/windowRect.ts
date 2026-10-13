import React from 'react';
import { NativeMethods } from 'react-native';

export type Rect = { top: number; left: number; width: number; height: number };

/**
 * measureInWindow gives screen-absolute coordinates. Retried via rAF on failure: the native view can
 * still be mid-creation when this runs, and measureInWindow then calls back with no arguments at all
 * (x/y come back undefined) — keeps retrying until the view actually exists. Self-terminates on
 * unmount, since the ref goes null and further calls become no-ops.
 */
export const measureRectInWindow = (
  ref: React.RefObject<Pick<NativeMethods, 'measureInWindow'> | null>,
  onMeasured: (rect: Rect) => void,
) => {
  const measure = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        requestAnimationFrame(measure);
        return;
      }
      onMeasured({ left: x, top: y, width, height });
    });
  };
  requestAnimationFrame(measure);
};

/** Overlap of two window rects, or null when they don't overlap. */
export const intersectRects = (a: Rect, b: Rect): Rect | null => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
};

/**
 * A window rect re-expressed relative to `container`'s window rect: where to absolutely position
 * something inside `container` so it lands on `rect`. Insets are measured against the container's
 * padding box, so this holds for a padded container (a SafeAreaView) too.
 */
export const rectRelativeTo = (rect: Rect, container: Rect): Rect => ({
  ...rect,
  left: rect.left - container.left,
  top: rect.top - container.top,
});
