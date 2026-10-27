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

const Checkbox: React.FC<CheckboxProps> = ({ value, onValueChange, accessibilityLabel, testID }) => {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => onValueChange(!value)}
      hitSlop={8}
      testID={testID}
    >
      <View
        style={[
          styles.box,
          value ? { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary } : { borderColor: colors.borderStrong },
        ]}
      >
        {value && <CheckmarkIcon variant="filled" size={12} color={colors.white} />}
      </View>
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
