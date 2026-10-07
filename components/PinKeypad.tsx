import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import { PIN_LENGTH } from '../helpers/pinLock';
import BackspaceIcon from './icons/BackspaceIcon';
import loc from '../loc';

const shuffledDigits = (): string[] => {
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits;
};

const ORDERED_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

interface PinKeypadProps {
  scrambled?: boolean;
  onComplete: (pin: string) => void | Promise<void>;
  error?: boolean;
  onErrorShown?: () => void;
  disabled?: boolean;
}

const PinKeypad: React.FC<PinKeypadProps> = ({ scrambled, onComplete, error, onErrorShown, disabled }) => {
  const { colors } = useTheme();
  const [value, setValue] = useState('');
  // Bumped once per finished attempt (success or error), never mid-entry, so a
  // scrambled layout stays put while the user is still typing a PIN.
  const [attempt, setAttempt] = useState(0);
  // Locks input while onComplete runs and while the error shake plays, so digits typed in that
  // window aren't wiped by the shake's reset.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const shakeAnimation = useRef(new Animated.Value(0)).current;
  // Held in a ref so an inline callback from the parent doesn't re-run the shake effect.
  const onErrorShownRef = useRef(onErrorShown);
  onErrorShownRef.current = onErrorShown;

  const digitOrder = useMemo(() => {
    const digits = scrambled ? shuffledDigits() : ORDERED_DIGITS;
    // Keep 0 pinned to the bottom-center slot, matching a plain phone keypad layout.
    const withoutZero = digits.filter(d => d !== '0');
    return [...withoutZero, '0'];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrambled, attempt]);

  const playErrorShake = useCallback(
    (onDone?: () => void) => {
      setIsShaking(true);
      Animated.sequence([
        Animated.timing(shakeAnimation, { toValue: 10, duration: 60, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: -10, duration: 60, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 6, duration: 60, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 0, duration: 60, easing: Easing.linear, useNativeDriver: true }),
      ]).start(() => {
        setValue('');
        setAttempt(a => a + 1);
        setIsShaking(false);
        onDone?.();
      });
    },
    [shakeAnimation],
  );

  useEffect(() => {
    if (!error) return;
    playErrorShake(() => onErrorShownRef.current?.());
  }, [error, playErrorShake]);

  const isLocked = disabled || isSubmitting || isShaking;

  const handleDigitPress = async (digit: string) => {
    if (isLocked || value.length >= PIN_LENGTH) return;
    const next = value + digit;
    setValue(next);
    if (next.length !== PIN_LENGTH) return;

    setIsSubmitting(true);
    try {
      await onComplete(next);
      setValue('');
      setAttempt(a => a + 1);
    } catch (e) {
      // Callers handle their own errors; this only keeps an unexpected rejection from leaving
      // the keypad stuck on a full row of dots.
      console.warn('PinKeypad onComplete failed:', e);
      playErrorShake();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackspace = () => {
    if (isLocked) return;
    setValue(prev => prev.slice(0, -1));
  };

  const dotColor = error ? colors.statusError : colors.brandPrimary;

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnimation }] }]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, { borderColor: dotColor }, i < value.length && { backgroundColor: dotColor }]} />
        ))}
      </Animated.View>
      <View style={styles.grid}>
        {digitOrder.map((digit, i) =>
          digit === '0' ? (
            <React.Fragment key="row-0">
              <View style={styles.key} />
              <Pressable
                key={digit}
                style={({ pressed }) => [
                  styles.key,
                  styles.keyButton,
                  { backgroundColor: colors.fieldBackground },
                  pressed && styles.keyPressed,
                ]}
                onPress={() => handleDigitPress(digit)}
                disabled={isLocked}
                accessibilityRole="button"
                accessibilityLabel={digit}
              >
                <Text style={[styles.keyText, { color: colors.textPrimary }]}>{digit}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.key, styles.keyButton, pressed && styles.keyPressed]}
                onPress={handleBackspace}
                disabled={isLocked}
                accessibilityRole="button"
                accessibilityLabel={loc.settings.pin_backspace}
                testID="PinBackspace"
              >
                <BackspaceIcon size={22} color={colors.iconSecondary} />
              </Pressable>
            </React.Fragment>
          ) : (
            <Pressable
              key={digit}
              style={({ pressed }) => [
                styles.key,
                styles.keyButton,
                { backgroundColor: colors.fieldBackground },
                pressed && styles.keyPressed,
              ]}
              onPress={() => handleDigitPress(digit)}
              disabled={isLocked}
              accessibilityRole="button"
              accessibilityLabel={digit}
              testID={`PinKey${digit}`}
            >
              <Text style={[styles.keyText, { color: colors.textPrimary }]}>{digit}</Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
};

export default PinKeypad;

const KEY_SIZE = 72;

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 40,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    marginHorizontal: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: KEY_SIZE * 3 + 32,
    justifyContent: 'space-between',
  },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyButton: {
    borderRadius: KEY_SIZE / 2,
  },
  keyPressed: {
    opacity: 0.6,
  },
  keyText: {
    fontSize: 26,
    fontFamily: ClashFont.medium,
  },
});
