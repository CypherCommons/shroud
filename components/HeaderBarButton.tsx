import React from 'react';
import { Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { hasLiquidGlass } from '../modules/environment';
import { useTheme } from './themes';

interface HeaderBarButtonProps extends Omit<PressableProps, 'style'> {
  /** The button's own background, drawn only where the system doesn't put one behind it. A circle unless given. */
  backgroundStyle?: StyleProp<ViewStyle>;
}

/**
 * A navigation bar button. iOS 26 sets every bar item on a glass capsule of its own, so there the
 * button is just its glyph; elsewhere it sits on `backgroundStyle`, a circle by default.
 */
const HeaderBarButton: React.FC<HeaderBarButtonProps> = ({ backgroundStyle, children, ...props }) => {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        !hasLiquidGlass && (backgroundStyle ?? [styles.circle, { backgroundColor: colors.fieldBackground }]),
        pressed && styles.pressed,
      ]}
      {...props}
    >
      {children}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginTop: 8,
  },
  pressed: {
    opacity: 0.5,
  },
});

export default HeaderBarButton;
