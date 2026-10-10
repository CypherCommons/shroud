import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '../../components/ActionButton';
import presentAlert from '../../components/Alert';
import PassphraseField from '../../components/PassphraseField';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import { ClashFont } from '../../constants/fonts';
import { useStorage } from '../../hooks/context/useStorage';
import { useSettings } from '../../hooks/context/useSettings';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useBiometrics, unlockWithBiometrics } from '../../hooks/useBiometrics';
import loc from '../../loc';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { navigationRef } from '../../NavigationService';

// Shown instead of the wallet whenever the selected chain's wallet is waiting for its passphrase.
const PassphraseUnlock: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const insets = useSafeAreaInsets();
  const { unlockWallet, forgetLockedWallet } = useStorage();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const { isScreenCaptureAllowed } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();
  const [passphrase, setPassphrase] = useState('');
  const [isWrong, setIsWrong] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);

  useEffect(() => {
    if (!isScreenCaptureAllowed) enableScreenProtect();
    return () => {
      disableScreenProtect();
    };
  }, [isScreenCaptureAllowed, enableScreenProtect, disableScreenProtect]);

  const onUnlock = useCallback(async () => {
    if (!passphrase || isUnlocking) return;
    Keyboard.dismiss();
    setIsUnlocking(true);
    setIsWrong(false);
    // Lets the spinner render before key derivation blocks the JS thread.
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      if (await unlockWallet(passphrase)) {
        setPassphrase('');
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        navigationRef.current?.reset({ index: 0, routes: [{ name: 'WalletsList' }] });
      } else {
        setIsWrong(true);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      }
    } finally {
      setIsUnlocking(false);
    }
  }, [passphrase, isUnlocking, unlockWallet]);

  const onForgot = useCallback(() => {
    presentAlert({
      title: loc.passphrase.forgot_title,
      message: loc.passphrase.forgot_message,
      buttons: [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc.passphrase.forgot_confirm,
          style: 'destructive',
          // Same gate as deleting an open wallet.
          onPress: async () => {
            if ((await isBiometricUseCapableAndEnabled()) && !(await unlockWithBiometrics())) return;
            await forgetLockedWallet();
            navigationRef.current?.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
          },
        },
      ],
      options: { cancelable: false },
    });
  }, [forgetLockedWallet, isBiometricUseCapableAndEnabled]);

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.body}>
        <Image source={require('../../img/logo.png')} style={styles.logo} resizeMode="contain" />
        <View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.passphrase.unlock_title}</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>{loc.passphrase.unlock_subtitle}</Text>
        </View>

        <PassphraseField
          value={passphrase}
          onChangeText={text => {
            setPassphrase(text);
            setIsWrong(false);
          }}
          onSubmitEditing={onUnlock}
          returnKeyType="done"
          autoFocus
          testID="UnlockPassphraseInput"
        />
        {isWrong && (
          <Text style={[styles.error, { color: colors.statusError }]} testID="UnlockPassphraseWrong">
            {loc.passphrase.unlock_wrong}
          </Text>
        )}

        {isUnlocking && <ActivityIndicator size="large" color={colors.brandPrimary} />}
      </View>

      <View style={styles.spacer} />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        <ActionButton
          title={loc.passphrase.unlock_cta}
          onPress={onUnlock}
          disabled={!passphrase || isUnlocking}
          backgroundColor={colors.brandPrimary}
          color={colors.white}
          testID="UnlockPassphraseButton"
        />
        <TouchableOpacity onPress={onForgot} accessibilityRole="button" style={styles.link} testID="ForgotPassphrase">
          <Text style={[styles.linkText, { color: colors.textMuted }]}>{loc.passphrase.forgot}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('BitcoinNetworkSettings')}
          accessibilityRole="button"
          style={styles.link}
          testID="UnlockSwitchNetwork"
        >
          <Text style={[styles.linkText, { color: colors.textMuted }]}>{loc.passphrase.switch_network}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 0 },
  body: { gap: 20 },
  logo: { width: 100, height: 75, alignSelf: 'center', marginBottom: 12 },
  title: { fontFamily: ClashFont.medium, fontSize: 32, letterSpacing: -1, marginBottom: 8 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 20 },
  error: { fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 20 },
  spacer: { flex: 1 },
  footer: { paddingTop: 16, gap: 12 },
  link: { alignSelf: 'center', paddingVertical: 8 },
  linkText: { fontFamily: ClashFont.regular, fontSize: 15 },
});

export default PassphraseUnlock;
