import React, { forwardRef } from 'react';
import { Platform, StyleSheet, TextInput, TextInputProps } from 'react-native';

import { ClashFont } from '../constants/fonts';
import { caretProps, useTheme } from './themes';

// The input that goes inside a LabeledField. It owns the typography and the themed colours so
// the text stays in step with the field chrome around it wherever the pair is used.
const FieldTextInput = forwardRef<TextInput, TextInputProps>(({ style, ...props }, ref) => {
  const { colors } = useTheme();

  return (
    <TextInput
      ref={ref}
      style={[styles.input, { color: colors.textSecondary }, style]}
      placeholderTextColor={colors.textMuted}
      underlineColorAndroid="transparent"
      {...caretProps(colors)}
      {...props}
    />
  );
});

// The same input configured for a bitcoin address: long, wrapped, and never autocorrected.
export const FieldAddressInput: React.FC<TextInputProps> = ({ style, ...props }) => (
  <FieldTextInput style={[styles.address, style]} multiline autoCapitalize="none" autoCorrect={false} {...props} />
);

// The same input configured for a seed phrase. visible-password keeps Android keyboards from
// learning the words into their personal dictionary; autoCorrect alone doesn't stop that.
export const FieldMnemonicInput: React.FC<TextInputProps> = props => (
  <FieldTextInput
    multiline
    autoCapitalize="none"
    autoCorrect={false}
    spellCheck={false}
    keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
    {...props}
  />
);

export default FieldTextInput;

const styles = StyleSheet.create({
  input: {
    flex: 1,
    width: '100%',
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 20,
    padding: 0,
  },
  address: {
    // grows with wrapped text up to ~5 lines (comfortably fits a full silent-payment address
    // with no scrolling); caps further growth for pathological pastes instead of letting the
    // screen layout balloon
    maxHeight: 100,
  },
});
