import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { IconProps } from './icons/types';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';

interface TipCardProps {
  Icon: React.FC<IconProps>;
  /** Lead-in, in medium weight; `body` follows on the same line. */
  bold: string;
  body: string;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}

// One point of advice in the backup flow: an icon and a short sentence led by its key phrase.
const TipCard: React.FC<TipCardProps> = ({ Icon, bold, body, iconSize = 20, style }) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { borderColor: colors.accentSubtle }, style]}>
      <View style={styles.iconBadge}>
        <Icon size={iconSize} color={colors.tipIconColor} />
      </View>
      <Text style={styles.text}>
        <Text style={[styles.bold, { color: colors.textPrimary }]}>{bold}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: 17,
    gap: 12,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: { flex: 1, fontSize: 14, lineHeight: 20 },
  bold: { fontFamily: ClashFont.medium },
  body: { fontFamily: ClashFont.regular },
});

export default TipCard;
