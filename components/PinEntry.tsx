import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import PinKeypad from './PinKeypad';
import { useTheme } from './themes';
import { useSettings } from '../hooks/context/useSettings';
import { usePinAttempt } from '../hooks/usePinAttempt';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';

interface PinEntryProps {
  pinAttempt: ReturnType<typeof usePinAttempt>;
  /** Shows "Forgot PIN?" once enough wrong PINs have been entered. Only the lock screens pass it. */
  onForgotPin?: () => void;
  forgotPinTestID?: string;
}

/** PinKeypad wired to usePinAttempt, with the lockout countdown and the optional forgot-PIN link. */
const PinEntry: React.FC<PinEntryProps> = ({ pinAttempt, onForgotPin, forgotPinTestID }) => {
  const { colors } = useTheme();
  const { isPinLayoutScrambled } = useSettings();
  const { submitPin, pinError, clearPinError, isLockedOut, lockoutMessage, canOfferReset } = pinAttempt;

  return (
    <View>
      <PinKeypad
        scrambled={isPinLayoutScrambled}
        onComplete={submitPin}
        error={pinError}
        onErrorShown={clearPinError}
        disabled={isLockedOut}
      />
      {lockoutMessage && <Text style={[styles.lockoutText, { color: colors.textMuted }]}>{lockoutMessage}</Text>}
      {onForgotPin && canOfferReset && (
        <TouchableOpacity onPress={onForgotPin} accessibilityRole="button" testID={forgotPinTestID}>
          <Text style={[styles.forgotPinText, { color: colors.primary }]}>{loc.settings.pin_forgot}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default PinEntry;

const styles = StyleSheet.create({
  lockoutText: { fontFamily: ClashFont.regular, fontSize: 14, textAlign: 'center', marginTop: 8 },
  forgotPinText: { fontFamily: ClashFont.medium, fontSize: 15, textAlign: 'center', marginTop: 16 },
});
