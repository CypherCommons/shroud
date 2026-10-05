import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';

interface ToastProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Optional button on the right, e.g. "Request" on the zero-balance toast. */
  action?: { label: string; onPress: () => void; testID?: string };
  /** Called when the toast hides itself or the back button is pressed. */
  onHide: () => void;
  durationMs?: number;
  testID?: string;
}

const FADE_MS = 200;

/** A short, non-blocking message at the top of the screen that fades out on its own. */
const Toast: React.FC<ToastProps> = ({ visible, title, subtitle, action, onHide, durationMs = 4000, testID }) => {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  // Stays mounted through the fade-out after `visible` turns false.
  const [isMounted, setIsMounted] = useState(visible);
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
      const timer = setTimeout(() => onHideRef.current(), durationMs);
      return () => clearTimeout(timer);
    }
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setIsMounted(false);
    });
  }, [visible, durationMs, opacity]);

  if (!isMounted) return null;

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onHide}>
      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View
          testID={testID}
          style={[styles.toast, { backgroundColor: colors.background, borderColor: colors.borderDefault, opacity }]}
        >
          <View style={styles.text}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
          </View>
          {action ? (
            <TouchableOpacity
              testID={action.testID}
              style={[styles.actionButton, { backgroundColor: colors.brandPrimary }]}
              onPress={action.onPress}
              accessibilityRole="button"
            >
              <Text style={[styles.actionText, { color: colors.white }]}>{action.label}</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
};

export default Toast;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    top: 51,
    left: 23,
    right: 23,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontFamily: ClashFont.semibold,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: ClashFont.regular,
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  actionText: {
    fontSize: 15,
    fontFamily: ClashFont.medium,
  },
});
