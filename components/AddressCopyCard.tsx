import Clipboard from '@react-native-clipboard/clipboard';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';
import { ShroudText } from '../ShroudComponents';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';
import CopyIcon from './icons/CopyIcon';
import { useTheme } from './themes';

interface AddressCopyCardProps {
  text: string;
  testID?: string;
}

const AddressCopyCard: React.FC<AddressCopyCardProps> = ({ text, testID = 'AddressCopyCard' }) => {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCopied(false);
  }, [text]);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const onCopy = () => {
    Clipboard.setString(text);
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1000);
  };

  return (
    <Pressable onPress={onCopy} accessibilityRole="button" testID={testID} style={[styles.card, { backgroundColor: colors.surfaceSubtle }]}>
      <ShroudText testID="AddressValue" style={[styles.address, { color: colors.textSecondary }]}>
        {text}
      </ShroudText>
      <View style={styles.copyRow}>
        <CopyIcon size={16} color={colors.textMuted} />
        <ShroudText style={[styles.copyLabel, { color: colors.textMuted }]}>
          {copied ? loc.receive.copied : loc.receive.tap_to_copy}
        </ShroudText>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  address: {
    fontFamily: ClashFont.regular,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  copyLabel: {
    fontFamily: ClashFont.regular,
    fontSize: 12,
    lineHeight: 20,
    letterSpacing: -0.15,
  },
});

export default AddressCopyCard;
