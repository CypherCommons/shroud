import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PinEntry from './PinEntry';
import { useTheme } from './themes';
import { usePinAttempt } from '../hooks/usePinAttempt';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';

interface PinPromptProps {
  subtitle: string;
  onSuccess: () => void;
}

/**
 * Centered PIN entry for a screen that has to confirm the PIN before showing something. Owns the PIN
 * check, so the lockout is read from the keychain only once the prompt shows.
 */
const PinPrompt: React.FC<PinPromptProps> = ({ subtitle, onSuccess }) => {
  const { colors } = useTheme();
  const pinAttempt = usePinAttempt(onSuccess);

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
