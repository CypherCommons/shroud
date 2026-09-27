import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StackActions, useFocusEffect } from '@react-navigation/native';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import SettingsNavRow from '../../components/SettingsNavRow';
import InfoBanner from '../../components/InfoBanner';
import presentAlert from '../../components/Alert';
import PromptPasswordConfirmationModal, {
  MODAL_TYPES,
  PromptPasswordConfirmationModalHandle,
} from '../../components/PromptPasswordConfirmationModal';
import { useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useStorage } from '../../hooks/context/useStorage';
import { useSettings } from '../../hooks/context/useSettings';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import { hasPinSet } from '../../helpers/pinLock';
import loc from '../../loc';
import { ClashFont } from '../../constants/fonts';

const Security: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const { wallets, saveToDisk, isStorageEncrypted, encryptStorage, decryptStorage } = useStorage();
  const { isDeviceBiometricCapable, biometricEnabled, setBiometricUseEnabled } = useBiometrics();
  const { isPinLayoutScrambled, setIsPinLayoutScrambledStorage } = useSettings();
  const [currentLoadingSwitch, setCurrentLoadingSwitch] = useState<string | null>(null);
  const [deviceBiometricCapable, setDeviceBiometricCapable] = useState(false);
  const [pinIsSet, setPinIsSet] = useState(false);
  const [storageIsEncrypted, setStorageIsEncrypted] = useState(false);
  const [modalType, setModalType] = useState<keyof typeof MODAL_TYPES>(MODAL_TYPES.CREATE_PASSWORD);
  const promptRef = useRef<PromptPasswordConfirmationModalHandle>(null);
  const [showScramblePinWarning, setShowScramblePinWarning] = useState(false);
  const scramblePinWarningTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scramblePinWarningTimeout.current) clearTimeout(scramblePinWarningTimeout.current);
    };
  }, []);

  const wallet = wallets[0];

  const cardStyle = [styles.card, { borderColor: colors.borderDefault, backgroundColor: colors.fieldBackground }];

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      (async () => {
        const [biometricCapable, pinSet, encrypted] = await Promise.all([
          isDeviceBiometricCapable(),
          hasPinSet().catch(() => true),
          isStorageEncrypted(),
        ]);
        if (!isActive) return;
        setDeviceBiometricCapable(biometricCapable);
        setPinIsSet(pinSet);
        setStorageIsEncrypted(encrypted);
      })();
      return () => {
        isActive = false;
      };
    }, [isDeviceBiometricCapable, isStorageEncrypted]),
  );

  const onUseBiometricSwitch = async (value: boolean) => {
    if (value && !deviceBiometricCapable) {
      presentAlert({ message: loc.settings.biom_no_passcode });
      return;
    }
    setCurrentLoadingSwitch('biometric');
    if (await unlockWithBiometrics()) {
      setBiometricUseEnabled(value);
    }
    setCurrentLoadingSwitch(null);
  };

  const onScramblePinSwitch = (value: boolean) => {
    if (value && !pinIsSet) {
      if (scramblePinWarningTimeout.current) clearTimeout(scramblePinWarningTimeout.current);
      setShowScramblePinWarning(true);
      scramblePinWarningTimeout.current = setTimeout(() => setShowScramblePinWarning(false), 4000);
      return;
    }
    setIsPinLayoutScrambledStorage(value);
  };

  const onEncryptStorageSwitch = (value: boolean) => {
    setCurrentLoadingSwitch('encrypt');
    if (value) {
      setModalType(MODAL_TYPES.CREATE_PASSWORD);
      promptRef.current?.present();
      return;
    }
    presentAlert({
      title: loc.settings.encrypt_decrypt,
      message: loc.settings.encrypt_decrypt_q,
      buttons: [
        { text: loc._.cancel, style: 'cancel', onPress: () => setCurrentLoadingSwitch(null) },
        {
          text: loc._.ok,
          style: 'destructive',
          onPress: () => {
            setModalType(MODAL_TYPES.ENTER_PASSWORD);
            promptRef.current?.present();
          },
        },
      ],
      options: { cancelable: false },
    });
  };

  const onPasswordConfirmed = async (password: string): Promise<boolean> => {
    try {
      if (modalType === MODAL_TYPES.CREATE_PASSWORD) {
        await encryptStorage(password);
        await saveToDisk();
        setModalType(MODAL_TYPES.SUCCESS);
        setStorageIsEncrypted(true);
        return true;
      }
      await decryptStorage(password);
      await saveToDisk();
      navigation.dispatch(StackActions.popToTop());
      return true;
    } catch (error) {
      if (modalType === MODAL_TYPES.CREATE_PASSWORD) presentAlert({ message: (error as Error).message });
      return false;
    } finally {
      setCurrentLoadingSwitch(null);
    }
  };

  const onHideBalanceSwitch = async (value: boolean) => {
    if (!wallet) return;
    wallet.hideBalance = value;
    await saveToDisk();
  };

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} testID="SecurityScrollView">
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>{loc.settings.network_section_authentication}</Text>
      <View style={cardStyle}>
        <SettingsToggleRow
          title={loc.settings.security_biometrics_face_id}
          subtitle={loc.settings.security_biometrics_subtitle}
          value={biometricEnabled}
          onValueChange={onUseBiometricSwitch}
          disabled={currentLoadingSwitch !== null}
          testID="BiometricsSwitch"
        />
        <SettingsNavRow
          title={pinIsSet ? loc.settings.security_change_pin : loc.settings.security_set_pin}
          onPress={() => navigation.navigate('ChangePin')}
          testID="ChangePinRow"
        />
        <SettingsToggleRow
          title={loc.settings.security_scramble_pin}
          value={isPinLayoutScrambled}
          onValueChange={onScramblePinSwitch}
          testID="ScramblePinSwitch"
        />
        {showScramblePinWarning && (
          <InfoBanner
            variant="caution"
            text={loc.settings.security_scramble_pin_requires_pin_warning}
            containerStyle={styles.scramblePinWarning}
          />
        )}
        <SettingsToggleRow
          title={loc.settings.encrypt_enc_and_pass}
          value={storageIsEncrypted}
          onValueChange={onEncryptStorageSwitch}
          disabled={currentLoadingSwitch !== null}
          showSeparator={storageIsEncrypted}
          testID="EncyptedAndPasswordProtectedSwitch"
        />
        {storageIsEncrypted && (
          <SettingsNavRow
            title={loc.settings.plausible_deniability}
            onPress={() => navigation.navigate('PlausibleDeniability')}
            showSeparator={false}
            testID="PlausibleDeniabilityButton"
          />
        )}
      </View>

      <Text style={[styles.sectionHeader, styles.sectionHeaderGap, { color: colors.textMuted }]}>
        {loc.settings.general_display_header}
      </Text>
      <View style={cardStyle}>
        <SettingsToggleRow
          title={loc.settings.security_hide_balance}
          value={!!wallet?.hideBalance}
          onValueChange={onHideBalanceSwitch}
          showSeparator={false}
          testID="HideBalanceSwitch"
        />
      </View>

      <Text style={[styles.sectionHeader, styles.sectionHeaderGap, { color: colors.textMuted }]}>
        {loc.settings.security_backup_header}
      </Text>
      <View style={cardStyle}>
        <SettingsNavRow
          title={loc.settings.security_view_recovery_phrase}
          onPress={() => navigation.navigate('ViewRecoveryPhrase')}
          testID="ViewRecoveryPhraseRow"
        />
        <SettingsNavRow
          title={loc.settings.security_export_wallet}
          onPress={() =>
            wallet && navigation.navigate('WalletExportRoot', { screen: 'WalletExport', params: { walletID: wallet.getID() } })
          }
          showSeparator={false}
          testID="ExportWalletRow"
        />
      </View>

      <PromptPasswordConfirmationModal
        ref={promptRef}
        modalType={modalType}
        onConfirmationSuccess={onPasswordConfirmed}
        onConfirmationFailure={() => setCurrentLoadingSwitch(null)}
      />
    </SafeAreaScrollView>
  );
};

export default Security;

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sectionHeader: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionHeaderGap: {
    marginTop: 24,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  scramblePinWarning: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
});
