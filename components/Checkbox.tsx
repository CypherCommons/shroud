import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import CheckmarkIcon from './icons/CheckmarkIcon';
import { useTheme } from './themes';

interface CheckboxProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel?: string;
  testID?: string;
}

/** The box alone, for a row that is itself the pressable control. */
export const CheckboxBox: React.FC<{ value: boolean }> = ({ value }) => {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.box,
        value ? { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary } : { borderColor: colors.checkboxUncheckedColor },
      ]}
    >
      {value && <CheckmarkIcon variant="filled" size={12} color={colors.white} />}
    </View>
  );
};

const Checkbox: React.FC<CheckboxProps> = ({ value, onValueChange, accessibilityLabel, testID }) => {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => onValueChange(!value)}
      hitSlop={8}
      testID={testID}
    >
      <CheckboxBox value={value} />
    </Pressable>
  );
};

export default Checkbox;

const styles = StyleSheet.create({
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
