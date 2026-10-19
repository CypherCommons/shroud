import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { ClashFont } from '../constants/fonts';
import { IconProps } from './icons/types';
import { useTheme } from './themes';

interface ActionButtonProps {
  title: string;
  onPress: () => void;
  /** Drawn to the left of the title, in the title's colour unless `iconColor` says otherwise. */
  Icon?: React.FC<IconProps>;
  iconSize?: number;
  backgroundColor: string;
  /** Applied to both the title and the icon, so the two never drift apart. */
  color: string;
  /** For a design that tints the icon apart from the title. The loading spinner follows it too. */
  iconColor?: string;
  /** Outlined variant, e.g. the destructive "Remove contact" button. */
  borderColor?: string;
  /** Swaps in the shared disabled colours, so every disabled CTA looks the same. */
  disabled?: boolean;
  /**
   * Busy: a spinner in the icon's place, and presses ignored until it's over. The enabled colours
   * stay, since busy isn't unavailable; pass a title that says what's under way.
   */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// The app's full-width call to action: a 56pt pill with an optional leading glyph. Enabled colours
// stay the caller's to pick, so one button covers the brand, tinted and destructive variants without
// growing a taxonomy of them.
const ActionButton: React.FC<ActionButtonProps> = ({
  title,
  onPress,
  Icon,
  iconSize = 24,
  backgroundColor,
  color,
  iconColor,
  borderColor,
  disabled,
  loading = false,
  style,
  testID,
}) => {
  const { colors } = useTheme();
  const fill = disabled ? colors.accentSubtle : backgroundColor;
  const tint = disabled ? colors.textMuted : color;
  const glyphTint = disabled ? colors.textMuted : (iconColor ?? color);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={loading ? { busy: true } : undefined}
      disabled={loading || disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        actionButtonStyles.button,
        borderColor !== undefined && actionButtonStyles.outlined,
        { backgroundColor: fill, borderColor },
        style,
        // every tap gets an answer under the finger, even one whose result takes a moment
        pressed && actionButtonStyles.pressed,
      ]}
    >
      {loading ? (
        // in a box of the icon's size, so the title doesn't move when the spinner takes its place
        <View style={[actionButtonStyles.glyphBox, { width: iconSize, height: iconSize }]}>
          <ActivityIndicator color={glyphTint} testID={testID === undefined ? undefined : `${testID}Spinner`} />
        </View>
      ) : (
        Icon !== undefined && <Icon size={iconSize} color={glyphTint} />
      )}
      <Text style={[actionButtonStyles.title, { color: tint }]}>{title}</Text>
    </Pressable>
  );
};

export default ActionButton;

// Exported so pill-shaped controls that can't be an ActionButton (e.g. a menu trigger) keep its geometry.
export const actionButtonStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  outlined: { borderWidth: 1 },
  // what the app's hand-rolled 56pt buttons dim to while held
  pressed: { opacity: 0.85 },
  glyphBox: { alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: ClashFont.medium, fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
