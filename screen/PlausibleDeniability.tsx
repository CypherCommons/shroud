import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StackActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';
import presentAlert from '../components/Alert';
import ActionButton from '../components/ActionButton';
import InfoBanner from '../components/InfoBanner';
import SafeAreaScrollView from '../components/SafeAreaScrollView';
import { Loading } from '../components/Loading';
import { useTheme } from '../components/themes';
import loc from '../loc';
import { useStorage } from '../hooks/context/useStorage';
import { useContacts } from '../hooks/context/useContacts';
import PromptPasswordConfirmationModal, {
  PromptPasswordConfirmationModalHandle,
  MODAL_TYPES,
} from '../components/PromptPasswordConfirmationModal';
import { useExtendedNavigation } from '../hooks/useExtendedNavigation';
import { ClashFont } from '../constants/fonts';

const PlausibleDeniability: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { cachedPassword, isPasswordInUse, createFakeStorage, resetWallets } = useStorage();
  const { resetContacts } = useContacts();
  const [isLoading, setIsLoading] = useState(false);
  const [modalType, setModalType] = useState<keyof typeof MODAL_TYPES>(MODAL_TYPES.CREATE_FAKE_STORAGE);
  const navigation = useExtendedNavigation();
  const promptRef = useRef<PromptPasswordConfirmationModalHandle>(null);

  const handleOnCreateFakeStorageButtonPressed = async () => {
    setIsLoading(true);
    setModalType(MODAL_TYPES.CREATE_FAKE_STORAGE);
    await promptRef.current?.present();
  };

  const handleConfirmationSuccess = async (password: string) => {
    let success = false;
    const isProvidedPasswordInUse = password === cachedPassword || (await isPasswordInUse(password));
    if (isProvidedPasswordInUse) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      presentAlert({ message: loc.plausibledeniability.password_should_not_match });
      return false;
    }

    try {
      await createFakeStorage(password);
      resetWallets();
      resetContacts();
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);

      // Set the modal type to SUCCESS to show the success animation instead of the alert
      setModalType(MODAL_TYPES.SUCCESS);

      success = true;
      setTimeout(async () => {
        const popToTop = StackActions.popToTop();
        navigation.dispatch(popToTop);
      }, 3000);
    } catch {
      success = false;
      setIsLoading(false);
    }

    return success;
  };

  const handleConfirmationFailure = () => {
    setIsLoading(false);
  };

  return (
    <SafeAreaScrollView
      centerContent={isLoading}
      contentContainerStyle={isLoading ? undefined : styles.content}
      testID="PlausibleDeniabilityScrollView"
    >
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <Text style={[styles.description, { color: colors.textMuted }]}>{loc.plausibledeniability.help}</Text>
          <InfoBanner text={loc.plausibledeniability.help2} />

          <View style={styles.spacer} />

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
            <ActionButton
              title={loc.plausibledeniability.create_fake_storage}
              onPress={handleOnCreateFakeStorageButtonPressed}
              backgroundColor={colors.brandPrimary}
              color={colors.white}
              testID="CreateFakeStorageButton"
            />
          </View>
        </>
      )}
      <PromptPasswordConfirmationModal
        ref={promptRef}
        modalType={modalType}
        onConfirmationSuccess={handleConfirmationSuccess}
        onConfirmationFailure={handleConfirmationFailure}
      />
    </SafeAreaScrollView>
  );
};

export default PlausibleDeniability;

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  description: {
    fontFamily: ClashFont.regular,
    fontSize: 15,
    lineHeight: 22.5,
    marginBottom: 24,
  },
  spacer: {
    flex: 1,
    minHeight: 24,
  },
  footer: {
    paddingTop: 8,
  },
});
