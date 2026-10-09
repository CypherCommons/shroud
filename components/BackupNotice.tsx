import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { IconProps } from './icons/types';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';

interface BackupNoticeProps {
  Icon: React.FC<IconProps>;
  prefix: string;
  /** Highlighted in the brand colour, right after `prefix`. */
  emphasis: string;
  style?: StyleProp<ViewStyle>;
}

// A one-line reminder in the backup flow: an icon, a plain lead-in and the part that matters.
const BackupNotice: React.FC<BackupNoticeProps> = ({ Icon, prefix, emphasis, style }) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.banner, { backgroundColor: colors.surfaceSubtle, borderColor: colors.accentSubtle }, style]}>
      <Icon size={20} color={colors.brandPrimary} />
      <Text style={styles.text}>
        <Text style={{ color: colors.warningBannerPrefixText }}>{prefix}</Text>
        <Text style={[styles.emphasis, { color: colors.textBrand }]}>{emphasis}</Text>
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  text: { flex: 1, fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 20 },
  emphasis: { fontFamily: ClashFont.medium },
});

export default BackupNotice;
