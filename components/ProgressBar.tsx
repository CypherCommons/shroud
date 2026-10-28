import React, { useEffect, useState } from 'react';
import { Animated, DimensionValue, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { useTheme } from './themes';

interface ProgressBarProps {
  /** 0 to 1. Null or left out draws an indeterminate bar: a segment sweeping along the track. */
  progress?: number | null;
  /** The fill. Brand by default. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// The indeterminate segment's share of the track, and how long one sweep takes.
const SEGMENT = 0.35;
const SWEEP_MS = 1200;

/** An 8pt track that fills in the brand colour, as on SyncScreen and the update screens. */
const ProgressBar: React.FC<ProgressBarProps> = ({ progress = null, color, style, testID }) => {
  const { colors } = useTheme();
  const fillColor = color ?? colors.brandPrimary;
  // Both bars move by translateX, which the native driver animates in points: the track's width.
  const [trackWidth, setTrackWidth] = useState(0);

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: progress === null || progress < 1 }}
      accessibilityValue={progress === null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }}
      style={[styles.track, { backgroundColor: colors.borderDefault }, style]}
      onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
    >
      {progress === null ? (
        trackWidth > 0 && <Sweep color={fillColor} width={trackWidth} />
      ) : (
        <Fill progress={progress} color={fillColor} width={trackWidth} testID={testID === undefined ? undefined : `${testID}Fill`} />
      )}
    </View>
  );
};

/**
 * A full-width bar slid in from the left: a transform runs on the native driver, where width can't, so
 * the bar keeps moving while the JS thread is busy (a scan's Rust calls hold it). Starts at its value
 * rather than growing from empty, so a bar that opens full is full from the first frame.
 */
const Fill: React.FC<{ progress: number; color: string; width: number; testID?: string }> = ({ progress, color, width, testID }) => {
  const value = Math.min(Math.max(progress, 0), 1);
  const [fill] = useState(() => new Animated.Value(value));

  useEffect(() => {
    const animation = Animated.timing(fill, { toValue: value, duration: 400, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [value, fill]);

  // Before the track's first layout there's no width to slide by, so draw the bar at its value.
  const position =
    width > 0
      ? { width, transform: [{ translateX: fill.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }
      : { width: `${value * 100}%` as DimensionValue };

  return <Animated.View testID={testID} style={[styles.bar, { backgroundColor: color }, position]} />;
};

const Sweep: React.FC<{ color: string; width: number }> = ({ color, width }) => {
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const segmentWidth = width * SEGMENT;

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          width: segmentWidth,
          backgroundColor: color,
          transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-segmentWidth, width] }) }],
        },
      ]}
    />
  );
};

export default ProgressBar;

const styles = StyleSheet.create({
  track: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
});
