import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';

import CheckboxCheckedIcon from './icons/CheckboxCheckedIcon';
import CheckboxUncheckedIcon from './icons/CheckboxUncheckedIcon';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';

interface CheckboxRowProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const CheckboxRow: React.FC<CheckboxRowProps> = ({ label, checked, onToggle, style, testID }) => {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      style={[styles.row, style]}
      onPress={onToggle}
      testID={testID}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      {checked ? (
        <CheckboxCheckedIcon size={20} color={colors.brandPrimary} />
      ) : (
        <CheckboxUncheckedIcon size={20} color={colors.checkboxUncheckedColor} />
      )}
      <Text style={[styles.text, { color: colors.textPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  text: { flex: 1, fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22.5 },
});

export default CheckboxRow;
