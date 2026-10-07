import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PinEntry from './PinEntry';
import { useTheme } from './themes';
import { usePinAttempt } from '../hooks/usePinAttempt';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';

interface PinPromptProps {
  subtitle: string;
  pinAttempt: ReturnType<typeof usePinAttempt>;
}

/** Centered PIN entry for a screen that has to confirm the PIN before showing something. */
const PinPrompt: React.FC<PinPromptProps> = ({ subtitle, pinAttempt }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.root}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.settings.pin_enter}</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      <PinEntry pinAttempt={pinAttempt} />
    </View>
  );
};

export default PinPrompt;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: { fontFamily: ClashFont.medium, fontSize: 22, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 14, textAlign: 'center', marginBottom: 32 },
});
