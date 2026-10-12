import React from 'react';
import { Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { hasLiquidGlass } from '../modules/environment';

interface HeaderBarButtonProps extends Omit<PressableProps, 'style'> {
  /** The button's own background, drawn only where the system doesn't put one behind it. */
  backgroundStyle?: StyleProp<ViewStyle>;
}

/**
 * A navigation bar button. iOS 26 sets every bar item on a glass capsule of its own, so there the
 * button is just its glyph; elsewhere `backgroundStyle` draws its background.
 */
const HeaderBarButton: React.FC<HeaderBarButtonProps> = ({ backgroundStyle, children, ...props }) => (
  <Pressable
    accessibilityRole="button"
    style={({ pressed }) => [styles.button, !hasLiquidGlass && backgroundStyle, pressed && styles.pressed]}
    {...props}
  >
    {children}
  </Pressable>
);

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.5,
  },
});

export default HeaderBarButton;
