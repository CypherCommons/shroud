import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TextInputProps, TouchableOpacity, View } from 'react-native';

import FieldTextInput from './FieldTextInput';
import LabeledField from './LabeledField';
import EyeIcon from './icons/EyeIcon';
import Toggle from './Toggle';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

interface PassphraseFieldProps extends Pick<TextInputProps, 'value' | 'onChangeText' | 'onSubmitEditing' | 'returnKeyType' | 'autoFocus'> {
  label?: string;
  testID?: string;
}

// A BIP39 passphrase input. Hidden by default, and kept out of keyboard learning and password
// managers: the "password" content types would offer to save it, which defeats never storing it.
const PassphraseField: React.FC<PassphraseFieldProps> = ({ label = loc.passphrase.field_label, testID, ...inputProps }) => {
  const { colors } = useTheme();
  const [isVisible, setIsVisible] = useState(false);

  return (
    <LabeledField
      label={label}
      trailing={
        <TouchableOpacity
          onPress={() => setIsVisible(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={isVisible ? loc.passphrase.hide : loc.passphrase.show}
          hitSlop={HIT_SLOP}
          testID={testID ? `${testID}Toggle` : undefined}
        >
          <EyeIcon color={isVisible ? colors.brandPrimary : colors.textMuted} />
        </TouchableOpacity>
      }
    >
      <FieldTextInput
        {...inputProps}
        secureTextEntry={!isVisible}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        keyboardType={isVisible && Platform.OS === 'android' ? 'visible-password' : 'default'}
        accessibilityLabel={label}
        testID={testID}
      />
    </LabeledField>
  );
};

// The switch that reveals the passphrase fields on create and restore.
export const UsePassphraseToggle: React.FC<{ value: boolean; onValueChange: (value: boolean) => void }> = ({ value, onValueChange }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>{loc.passphrase.use_toggle}</Text>
      <Toggle value={value} onValueChange={onValueChange} accessibilityLabel={loc.passphrase.use_toggle} testID="UsePassphraseToggle" />
    </View>
  );
};

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleLabel: { flexShrink: 1, fontFamily: ClashFont.medium, fontSize: 14 },
});

export default PassphraseField;
