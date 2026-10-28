import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from './themes';

export const PauseIcon = ({ color = 'white', size = 32 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="22.7139 22.7139 19.8333 19.8333" fill="none">
    <Path
      d="M34.0472 42.5472V22.7139H42.5472V42.5472H34.0472ZM22.7139 42.5472V22.7139H31.2139V42.5472H22.7139ZM36.8805 39.7139H39.7139V25.5472H36.8805V39.7139ZM25.5472 39.7139H28.3805V25.5472H25.5472V39.7139Z"
      fill={color}
    />
  </Svg>
);

// The viewBox hugs the glyph, so `size` is the glyph's own size, as a button's icon slot expects.
export const PlayIcon = ({ color = 'white', size = 17 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="8.9333 8 17.3333 17.3333" fill="none">
    <Path
      d="M24.5334 16.6667L12.0001 24.5067L10.6667 25.3333V8L24.5334 16.6667ZM22.0001 16.6667L12.0001 10.4V22.9333L22.0001 16.6667Z"
      fill={color}
    />
  </Svg>
);

export type SyncStatusIconType = 'scanning' | 'paused' | 'done' | 'error';

interface SyncStatusIconProps {
  status: SyncStatusIconType;
  size?: number;
}

const SyncStatusIcon: React.FC<SyncStatusIconProps> = ({ status, size = 66 }) => {
  const { colors } = useTheme();
  // ring = outer ring + inner disc stroke, fill = inner disc fill, glyph = the symbol.
  // Exception: `error` draws no inner-disc stroke - the design carries that state entirely on the
  // outer ring in full-saturation red - so for `error` ring means the outer ring only.
  const iconColors = {
    scanning: { ring: colors.accentSubtle, fill: colors.surfaceSubtle, glyph: colors.brandPrimary },
    paused: { ring: colors.borderDefault, fill: colors.surfaceSubtle, glyph: colors.textMuted },
    done: { ring: colors.borderDefault, fill: colors.bgSuccess, glyph: colors.statusSuccess },
    error: { ring: colors.statusError, fill: colors.surfaceError, glyph: colors.statusError },
  };
  const c = iconColors[status];
  return (
    <Svg width={size} height={size} viewBox="0 0 66 66" fill="none">
      {/* Outer ring, identical in every status. Unfilled, so the badge sits on any surface. */}
      <Circle cx="32.9998" cy="32.9998" r="32.2464" fill="none" stroke={c.ring} strokeWidth="1.50691" />
      {status === 'paused' && (
        <>
          <Rect
            x="53.3979"
            y="53.3978"
            width="41.5345"
            height="41.5345"
            rx="20.7673"
            transform="rotate(180 53.3979 53.3978)"
            fill={c.fill}
          />
          <Rect
            x="53.3979"
            y="53.3978"
            width="41.5345"
            height="41.5345"
            rx="20.7673"
            transform="rotate(180 53.3979 53.3978)"
            stroke={c.ring}
            strokeWidth="1.50691"
          />
          <Path
            d="M34.0472 42.5472V22.7139H42.5472V42.5472H34.0472ZM22.7139 42.5472V22.7139H31.2139V42.5472H22.7139ZM36.8805 39.7139H39.7139V25.5472H36.8805V39.7139ZM25.5472 39.7139H28.3805V25.5472H25.5472V39.7139Z"
            fill={c.glyph}
          />
        </>
      )}

      {status === 'done' && (
        <>
          <Rect
            x="54.3393"
            y="54.3392"
            width="42.4759"
            height="42.4759"
            rx="21.238"
            transform="rotate(180 54.3393 54.3392)"
            fill={c.fill}
          />
          <Rect
            x="54.3393"
            y="54.3392"
            width="42.4759"
            height="42.4759"
            rx="21.238"
            transform="rotate(180 54.3393 54.3392)"
            stroke={c.ring}
            strokeWidth="1.50691"
          />
          <Path
            d="M29.5344 41.8365L21.2358 33.5379L23.3105 31.4633L29.5344 37.6872L42.8922 24.3294L44.9669 26.4041L29.5344 41.8365Z"
            fill={c.glyph}
          />
        </>
      )}

      {status === 'scanning' && (
        <>
          <Rect
            x="54.8503"
            y="54.8502"
            width="42.9869"
            height="42.9869"
            rx="21.4935"
            transform="rotate(180 54.8503 54.8502)"
            fill={c.fill}
          />
          <Rect
            x="54.8503"
            y="54.8502"
            width="42.9869"
            height="42.9869"
            rx="21.4935"
            transform="rotate(180 54.8503 54.8502)"
            stroke={c.ring}
            strokeWidth="1.50691"
          />
          <Path
            d="M45.728 35.4056V33.3422C45.728 26.5058 40.1719 20.9622 33.3196 20.9622C31.4556 20.9599 29.615 21.3781 27.9349 22.1857C26.2548 22.9932 24.7785 24.1693 23.6159 25.6264M20.948 31.3044V33.3678C20.948 40.2118 26.5013 45.7512 33.3563 45.7512C35.2151 45.7485 37.0498 45.3311 38.7268 44.5295C40.4039 43.7279 41.8809 42.5622 43.0503 41.1175"
            stroke={c.glyph}
            strokeWidth="2.21577"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M17.8459 33.3567L20.8926 30.3101L24.0778 33.3567M48.8668 33.3567L45.8201 36.4034L42.6349 33.3567"
            stroke={c.glyph}
            strokeWidth="2.21577"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {status === 'error' && (
        <>
          <Rect
            x="54.3393"
            y="54.3392"
            width="42.4759"
            height="42.4759"
            rx="21.238"
            transform="rotate(180 54.3393 54.3392)"
            fill={c.fill}
          />
          {/* Warning-circle glyph: 20x20 icon box centred in the 66 viewBox, per the error spec. */}
          <Circle cx="33" cy="33" r="7.5" stroke={c.glyph} strokeWidth="1.66607" />
          <Path d="M33 29.667V33" stroke={c.glyph} strokeWidth="1.66607" strokeLinecap="round" />
          <Circle cx="33" cy="36.333" r="0.833" fill={c.glyph} />
        </>
      )}
    </Svg>
  );
};

export default SyncStatusIcon;
