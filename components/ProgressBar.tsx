import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

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

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: progress === null || progress < 1 }}
      accessibilityValue={progress === null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }}
      style={[styles.track, { backgroundColor: colors.borderDefault }, style]}
    >
      {progress === null ? <Sweep color={fillColor} /> : <Fill progress={progress} color={fillColor} />}
    </View>
  );
};

/** Grows from empty when it appears, then follows `progress`. */
const Fill: React.FC<{ progress: number; color: string }> = ({ progress, color }) => {
  const [fill] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(fill, { toValue: progress, duration: 400, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [progress, fill]);

  return (
    <Animated.View
      style={[styles.bar, { backgroundColor: color, width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
    />
  );
};

const Sweep: React.FC<{ color: string }> = ({ color }) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const segmentWidth = trackWidth * SEGMENT;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}>
      <Animated.View
        style={[
          styles.bar,
          {
            width: segmentWidth,
            backgroundColor: color,
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-segmentWidth, trackWidth] }) }],
          },
        ]}
      />
    </View>
  );
};

export default ProgressBar;

const styles = StyleSheet.create({
  track: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
});
