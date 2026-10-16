import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ShroudText } from '../ShroudComponents';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';
import { BitcoinUnit } from '../models/bitcoinUnits';
import { isAmountEmpty } from '../helpers/send/format';
import CheckmarkIcon from './icons/CheckmarkIcon';
import { caretProps, useTheme } from './themes';

/**
 * Works around React Native 0.86 on iOS (Fabric) sizing a TextInput from its previous text whenever `value` is set
 * in code rather than typed: BaseTextInputShadowNode::measureContent measures the text held in native state, and
 * layout() only copies the new value into that state afterwards. Typing updates native state first, so only values
 * set in code are hit (Android's AndroidTextInputShadowNode measures the latest value). For those, the returned style
 * changes the input's minWidth by a hair, which rounds to the same pixels but makes Yoga measure again, now with the
 * new text. Delete this once iOS measures the latest value too.
 *
 * Pass every onChangeText text to `markTyped`, so a keystroke isn't taken for a value set in code.
 */
export const useRemeasureOnProgrammaticChange = (value: string | undefined, enabled: boolean) => {
  const typedRef = useRef<string | undefined>(undefined);
  const lastValueRef = useRef(value);
  const [remeasure, setRemeasure] = useState(false);

  useLayoutEffect(() => {
    if (enabled && value !== lastValueRef.current && value !== typedRef.current) setRemeasure(r => !r);
    lastValueRef.current = value;
  }, [enabled, value]);
  // After every render, so a keystroke only ever vouches for the render it caused, even when the parent
  // rejects it and the value doesn't change.
  useLayoutEffect(() => {
    typedRef.current = undefined;
  });

  const markTyped = useCallback((text: string) => {
    typedRef.current = text;
  }, []);

  return { remeasureStyle: remeasure ? styles.amountRemeasure : undefined, markTyped };
};

interface AmountHeroProps {
  /** BTC amount as a string ('' when empty), or a display string in read-only mode. */
  amount?: string;
  /** Preformatted fiat estimate, e.g. "≈ ₹0". */
  fiat: string;
  editable?: boolean;
  onChangeAmount?: (text: string) => void;
  /** Shown beneath the fiat line in editable mode (e.g. "Tap amount to edit"). */
  showHint?: boolean;
  /** When provided (editable mode), renders the "Max" pill. */
  onUseMax?: () => void;
  useMaxDisabled?: boolean;
  /** When true, the Max pill shows a tick and the "Sending Max" hint replaces the edit hint. */
  isMax?: boolean;
  /** Unit shown next to the amount. Defaults to BTC. */
  unit?: BitcoinUnit;
  /** When provided, the unit label becomes a button that toggles BTC <-> sats. */
  onToggleUnit?: () => void;
  /** Extra space below the unit label, pulling it up off the amount's baseline. Defaults to 0 (flush baseline, matches Confirm). Send's editable layout wants 8. */
  unitMarginBottom?: number;
}

const AmountHero: React.FC<AmountHeroProps> = ({
  amount,
  fiat,
  editable = false,
  onChangeAmount,
  showHint = false,
  onUseMax,
  useMaxDisabled = false,
  isMax = false,
  unit = BitcoinUnit.BTC,
  onToggleUnit,
  unitMarginBottom = 0,
}) => {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const empty = isAmountEmpty(amount);

  // Without this, a unit switch left "sats" where "BTC" had ended, or cut a BTC amount to "0.0".
  const { remeasureStyle, markTyped } = useRemeasureOnProgrammaticChange(amount, editable && Platform.OS === 'ios');
  const onChangeText = (text: string) => {
    markTyped(text);
    onChangeAmount?.(text);
  };

  const stylesHook = StyleSheet.create({
    amountFilled: { color: colors.textPrimary },
    amountEmpty: { color: colors.textDisabled },
    meta: { color: colors.textMuted },
    hint: { color: colors.textBrand },
    sendingMax: { color: colors.textBrand },
    // The pill fill is bg/brand whether or not Max is on - only the tick and the label change.
    useMax: { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderDefault },
    useMaxText: { color: colors.textBrand },
    unit: { marginBottom: unitMarginBottom },
  });

  const amountColor = empty ? stylesHook.amountEmpty : stylesHook.amountFilled;
  const unitLabel = unit === BitcoinUnit.SATS ? loc.units[BitcoinUnit.SATS] : loc.units[BitcoinUnit.BTC];

  return (
    <Pressable
      style={styles.container}
      accessibilityRole={editable && !isMax ? 'button' : undefined}
      onPress={editable && !isMax ? () => inputRef.current?.focus() : undefined}
    >
      <View style={styles.amountRow}>
        {editable ? (
          <TextInput
            ref={inputRef}
            style={[styles.amount, styles.amountInput, amountColor, remeasureStyle]}
            value={amount}
            onChangeText={onChangeText}
            placeholder="0"
            placeholderTextColor={colors.textDisabled}
            // One keypad for every unit: iOS doesn't swap the keypad of a focused field, so switching
            // from sats to BTC while typing would leave a pad without ".". Sats drop the "." anyway.
            keyboardType="decimal-pad"
            {...caretProps(colors)}
            editable={!isMax}
            testID="AmountHeroInput"
          />
        ) : (
          <ShroudText style={[styles.amount, amountColor]} testID="AmountHeroValue">
            {empty ? '0' : amount}
          </ShroudText>
        )}
        {onToggleUnit ? (
          <Pressable accessibilityRole="button" onPress={onToggleUnit} hitSlop={8} testID="AmountUnitToggle">
            <ShroudText style={[styles.unit, stylesHook.meta, stylesHook.unit]}>{unitLabel}</ShroudText>
          </Pressable>
        ) : (
          <ShroudText style={[styles.unit, stylesHook.meta, stylesHook.unit]}>{unitLabel}</ShroudText>
        )}
      </View>

      <ShroudText style={[styles.fiat, stylesHook.meta]}>{fiat}</ShroudText>

      {isMax ? (
        <ShroudText style={[styles.hint, stylesHook.sendingMax]}>{loc.send.sending_max}</ShroudText>
      ) : (
        showHint && <ShroudText style={[styles.hint, stylesHook.hint]}>{loc.send.tap_amount_to_edit}</ShroudText>
      )}

      {onUseMax && (
        <Pressable
          accessibilityRole="button"
          disabled={useMaxDisabled}
          onPress={onUseMax}
          style={[styles.useMax, stylesHook.useMax, useMaxDisabled && styles.useMaxDisabled]}
          testID="UseMaxButton"
        >
          {isMax && <CheckmarkIcon color={colors.brandPrimary} size={16} />}
          <ShroudText style={[styles.useMaxText, stylesHook.useMaxText]}>{isMax ? loc.send.max_active : loc.send.max}</ShroudText>
        </Pressable>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    gap: 3,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  amount: {
    fontFamily: ClashFont.medium,
    fontSize: 48,
    lineHeight: 48,
    letterSpacing: -1.2,
    textAlign: 'center',
    minWidth: 40,
    padding: 0,
  },
  // Gives way before the unit button does when an amount is too long for the row; the input then scrolls.
  amountInput: {
    flexShrink: 1,
  },
  // Differs from `amount`'s minWidth only so the input re-measures; rounds to the same pixels.
  amountRemeasure: {
    minWidth: 40.01,
  },
  unit: {
    fontFamily: ClashFont.regular,
    fontSize: 20,
    lineHeight: 30,
  },
  fiat: {
    fontFamily: ClashFont.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  hint: {
    fontFamily: ClashFont.medium,
    fontSize: 12,
    lineHeight: 22,
    textAlign: 'center',
  },
  useMax: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 32,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
  },
  useMaxDisabled: {
    opacity: 0.5,
  },
  useMaxText: {
    fontFamily: ClashFont.medium,
    fontSize: 14,
    lineHeight: 24,
  },
});

export default AmountHero;
