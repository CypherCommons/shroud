import React, { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';

import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';
import { ShroudText } from '../ShroudComponents';
import { ClashFont } from '../constants/fonts';
import { shadowSm, useTheme } from './themes';

export interface PillSegment {
  label: string;
  /** Keeps its place but can't be picked. */
  disabled?: boolean;
  testID?: string;
}

interface PillSegmentedControlProps {
  segments: PillSegment[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

const TRACK_PADDING = 4;
const SEGMENT_GAP = 8;

const PillSegmentedControl: React.FC<PillSegmentedControlProps> = ({ segments, selectedIndex, onChange }) => {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;

  const segmentWidth =
    segments.length > 0 && trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2 - SEGMENT_GAP * (segments.length - 1)) / segments.length : 0;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: selectedIndex * (segmentWidth + SEGMENT_GAP),
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  }, [selectedIndex, segmentWidth, translateX]);

  const stylesHook = StyleSheet.create({
    labelSelected: {
      color: colors.textSecondary,
    },
    labelUnselected: {
      color: colors.textMuted,
    },
    labelDisabled: {
      color: colors.textDisabled,
    },
  });

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const handlePress = (index: number) => {
    if (index === selectedIndex) return;
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
    onChange(index);
  };

  if (!Array.isArray(segments) || segments.length === 0) return null;

  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceBrandSubtle, borderColor: colors.accentSubtle }]} onLayout={onTrackLayout}>
      {segmentWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            {
              width: segmentWidth,
              backgroundColor: colors.background,
              borderColor: colors.accentSubtle,
              transform: [{ translateX }],
            },
          ]}
        />
      )}
      {segments.map(({ label, disabled = false, testID }, index) => (
        <Pressable
          // Segments are positional (selection is by index), so their index is their identity.
          key={index}
          style={styles.segment}
          accessibilityRole="button"
          accessibilityState={{ selected: index === selectedIndex, disabled }}
          disabled={disabled}
          onPress={() => handlePress(index)}
          testID={testID}
        >
          <ShroudText
            numberOfLines={1}
            style={[
              styles.label,
              index === selectedIndex
                ? [styles.labelSelected, stylesHook.labelSelected]
                : [styles.labelUnselected, disabled ? stylesHook.labelDisabled : stylesHook.labelUnselected],
            ]}
          >
            {label}
          </ShroudText>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  labelSelected: {
    fontFamily: ClashFont.medium,
  },
  labelUnselected: {
    fontFamily: ClashFont.regular,
  },
  track: {
    flexDirection: 'row',
    width: '100%',
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    padding: TRACK_PADDING,
    gap: SEGMENT_GAP,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    bottom: TRACK_PADDING,
    borderRadius: 16,
    borderWidth: 1,
    ...shadowSm,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
  },
});

export default PillSegmentedControl;
