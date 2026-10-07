import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import PinKeypad from '../../components/PinKeypad';
import InfoBanner from '../../components/InfoBanner';
import ActionButton from '../../components/ActionButton';
import CheckmarkIcon from '../../components/icons/CheckmarkIcon';
import presentAlert from '../../components/Alert';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { clearPin, hasPinSet, PIN_LENGTH, setPin as persistPin } from '../../helpers/pinLock';
import { usePinAttempt } from '../../hooks/usePinAttempt';
import { ClashFont } from '../../constants/fonts';
import loc from '../../loc';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type Step = 'checking' | 'current' | 'new' | 'confirm' | 'success';

const ChangePin: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const insets = useSafeAreaInsets();
  // Remove mode: only the current-PIN step, then the PIN is cleared.
  const isRemoving = useRoute<RouteProp<DetailViewStackParamList, 'ChangePin'>>().params?.remove === true;
  const { isPinLayoutScrambled, setIsPinLayoutScrambledStorage } = useSettings();
  const [step, setStep] = useState<Step>('checking');
  const [hasVerifyStep, setHasVerifyStep] = useState(false);
  const [error, setError] = useState(false);
  const [showMismatch, setShowMismatch] = useState(false);
  const newPinRef = useRef<string | null>(null);
  // Set only for a confirm-step mismatch: the error flash plays out on the 'confirm' screen,
  // then onErrorShown bounces the user back to 'new' to pick a fresh PIN.
  const errorNextStepRef = useRef<Step | null>(null);

  useEffect(() => {
    // A keychain read error fails closed: ask for the current PIN rather than letting it be replaced unchecked.
    hasPinSet()
      .catch(() => true)
      .then(exists => {
        if (isRemoving) {
          if (!exists) {
            navigation.goBack();
            return;
          }
          navigation.setOptions({ title: loc.settings.security_remove_pin });
        }
        setHasVerifyStep(exists);
        setStep(exists ? 'current' : 'new');
        if (!exists) navigation.setOptions({ title: loc.settings.security_set_pin });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalSteps = isRemoving ? 1 : hasVerifyStep ? 3 : 2;

  // How many progress-bar segments are filled for the step currently on screen: 'current' only
  // exists when verifying first, so it always takes segment 1; 'new'/'confirm' shift up by one in
  // that case to make room for it.
  const stepIndex = (() => {
    switch (step) {
      case 'current':
        return 1;
      case 'new':
        return hasVerifyStep ? 2 : 1;
      case 'confirm':
        return hasVerifyStep ? 3 : 2;
      default:
        return 0;
    }
  })();

  const stepTitle = useCallback(() => {
    switch (step) {
      case 'current':
        return loc.settings.pin_enter_current;
      case 'confirm':
        return loc.settings.pin_confirm_new;
      default:
        return loc.settings.pin_enter_new;
    }
  }, [step]);

  const stepSubtitle = useCallback(() => {
    switch (step) {
      case 'current':
        return isRemoving ? loc.settings.pin_remove_subtitle : loc.settings.pin_enter_current_subtitle;
      case 'confirm':
        return loc.settings.pin_confirm_new_subtitle;
      default:
        return loc.formatString(loc.settings.pin_enter_new_subtitle, { count: PIN_LENGTH });
    }
  }, [step, isRemoving]);

  const goToStep = (next: Step) => {
    setShowMismatch(false);
    setStep(next);
  };

  // The current-PIN check goes through the shared wrong-attempt limiter like every other PIN entry,
  // so the PIN can't be guessed here from inside an unlocked app.
  const {
    submitPin: submitCurrentPin,
    pinError: currentPinError,
    clearPinError: clearCurrentPinError,
    isLockedOut,
    lockoutMessage,
  } = usePinAttempt(async () => {
    if (!isRemoving) {
      goToStep('new');
      return;
    }
    await clearPin();
    // Scrambling only applies to a PIN, and its switch can't be turned on without one.
    await setIsPinLayoutScrambledStorage(false);
    setStep('success');
  });

  const handleComplete = async (pin: string) => {
    try {
      await completeStep(pin);
    } catch (e) {
      console.warn('ChangePin keychain error:', e);
      presentAlert({ message: loc.settings.pin_storage_error });
    }
  };

  const completeStep = async (pin: string) => {
    if (step === 'current') {
      await submitCurrentPin(pin);
      return;
    }

    if (step === 'new') {
      newPinRef.current = pin;
      goToStep('confirm');
      return;
    }

    if (step === 'confirm') {
      if (pin === newPinRef.current) {
        await persistPin(pin);
        newPinRef.current = null;
        setStep('success');
      } else {
        newPinRef.current = null;
        setShowMismatch(true);
        errorNextStepRef.current = 'new';
        setError(true);
      }
    }
  };

  const handleErrorShown = () => {
    setError(false);
    clearCurrentPinError();
    if (errorNextStepRef.current) {
      // setStep, not goToStep: the mismatch banner has to stay up on the step the user is sent
      // back to. It's cleared once they finish that step.
      setStep(errorNextStepRef.current);
      errorNextStepRef.current = null;
    }
  };

  if (step === 'checking') {
    return <SafeAreaScrollView contentContainerStyle={styles.content} />;
  }

  if (step === 'success') {
    return (
      <SafeAreaScrollView contentContainerStyle={styles.successContent} testID="ChangePinScrollView">
        <View style={styles.successBody}>
          <View style={[styles.checkCircle, { backgroundColor: colors.surfaceSubtle }]}>
            <CheckmarkIcon size={32} color={colors.brandPrimary} />
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {isRemoving ? loc.settings.pin_removed : loc.settings.pin_set_success}
          </Text>
          <Text style={[styles.successSubtitle, { color: colors.textMuted }]}>
            {isRemoving ? loc.settings.pin_removed_subtitle : loc.settings.pin_updated_subtitle}
          </Text>
        </View>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
          <ActionButton
            title={loc.settings.security_back_to_security}
            onPress={() => navigation.goBack()}
            backgroundColor={colors.brandPrimary}
            color={colors.white}
            testID="PinUpdatedBackButton"
          />
        </View>
      </SafeAreaScrollView>
    );
  }

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} testID="ChangePinScrollView">
      <View style={styles.progressRow}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View key={i} style={[styles.progressSegment, { backgroundColor: i < stepIndex ? colors.brandPrimary : colors.borderDefault }]} />
        ))}
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{stepTitle()}</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>{stepSubtitle()}</Text>
      <PinKeypad
        key={step}
        scrambled={isPinLayoutScrambled}
        onComplete={handleComplete}
        error={error || currentPinError}
        onErrorShown={handleErrorShown}
        disabled={step === 'current' && isLockedOut}
      />
      {step === 'current' && lockoutMessage && <Text style={[styles.lockoutText, { color: colors.textMuted }]}>{lockoutMessage}</Text>}
      {showMismatch && <InfoBanner variant="error" text={loc.settings.pin_mismatch} containerStyle={styles.mismatchBanner} />}
    </SafeAreaScrollView>
  );
};

export default ChangePin;

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  progressRow: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    flexDirection: 'row',
    gap: 8,
  },
  progressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  title: {
    fontSize: 22,
    fontFamily: ClashFont.medium,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 12,
  },
  lockoutText: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
    textAlign: 'center',
    marginTop: 16,
  },
  mismatchBanner: {
    marginTop: 24,
    alignSelf: 'stretch',
  },
  successContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  successBody: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successSubtitle: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  footer: {
    paddingTop: 32,
  },
});
