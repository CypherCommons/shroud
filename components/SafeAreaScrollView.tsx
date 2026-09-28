import React, { useMemo, forwardRef } from 'react';
import { StyleSheet, ScrollViewProps } from 'react-native';
import { KeyboardAwareScrollView, KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from './themes';

// Space kept between the focused input and the keyboard.
export const KEYBOARD_BOTTOM_OFFSET = 24;

interface SafeAreaScrollViewProps extends ScrollViewProps {
  floatingButtonHeight?: number;
}

const SafeAreaScrollView = forwardRef<KeyboardAwareScrollViewRef, SafeAreaScrollViewProps>((props, ref) => {
  const { style, contentContainerStyle, floatingButtonHeight = 0, ...otherProps } = props;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const componentStyle = useMemo(() => {
    return StyleSheet.compose({ flex: 1, backgroundColor: colors.background }, style);
  }, [colors.background, style]);

  const contentStyle = useMemo(() => {
    // Calculate base inset paddings with proper typing
    const basePadding: {
      paddingBottom: number;
      paddingTop: number;
      paddingLeft?: number;
      paddingRight?: number;
    } = {
      paddingBottom: insets.bottom + floatingButtonHeight, // Add extra padding for the floating button
      paddingTop: insets.top > 0 ? 5 : 0, // Small padding if we have a safe area at top
    };

    // Only add horizontal paddings if they aren't explicitly defined in contentContainerStyle
    if (!StyleSheet.flatten(contentContainerStyle)?.paddingHorizontal && !StyleSheet.flatten(contentContainerStyle)?.paddingLeft) {
      basePadding.paddingLeft = insets.left;
    }

    if (!StyleSheet.flatten(contentContainerStyle)?.paddingHorizontal && !StyleSheet.flatten(contentContainerStyle)?.paddingRight) {
      basePadding.paddingRight = insets.right;
    }

    // Now compose with contentContainerStyle to ensure passed styles override defaults
    return StyleSheet.compose(basePadding, contentContainerStyle);
  }, [insets, contentContainerStyle, floatingButtonHeight]);

  return (
    // Scrolls the focused input above the keyboard on both platforms.
    <KeyboardAwareScrollView
      ref={ref}
      style={componentStyle}
      bottomOffset={KEYBOARD_BOTTOM_OFFSET}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustsScrollIndicatorInsets
      contentContainerStyle={contentStyle}
      {...otherProps}
    />
  );
});

export default SafeAreaScrollView;
