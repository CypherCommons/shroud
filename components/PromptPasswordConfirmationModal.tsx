import React, { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Easing, ViewStyle, Keyboard, Platform, UIManager } from 'react-native';
import BottomModal, { BottomModalHandle } from './BottomModal';
import { useTheme } from '../components/themes';
import loc from '../loc';
import ActionButton from './ActionButton';
import LabeledField from './LabeledField';
import FieldTextInput from './FieldTextInput';
import CheckmarkIcon from './icons/CheckmarkIcon';
import { ClashFont } from '../constants/fonts';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';
import { useKeyboard } from '../hooks/useKeyboard';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const MODAL_TYPES = {
  ENTER_PASSWORD: 'ENTER_PASSWORD',
  CREATE_PASSWORD: 'CREATE_PASSWORD',
  CREATE_FAKE_STORAGE: 'CREATE_FAKE_STORAGE',
  SUCCESS: 'SUCCESS',
} as const;

type ModalType = (typeof MODAL_TYPES)[keyof typeof MODAL_TYPES];

interface PromptPasswordConfirmationModalProps {
  modalType: ModalType;
  onConfirmationSuccess: (password: string) => Promise<boolean>;
  onConfirmationFailure: () => void;
}

export interface PromptPasswordConfirmationModalHandle {
  present: () => Promise<void>;
  dismiss: () => Promise<void>;
}

const PromptPasswordConfirmationModal = forwardRef<PromptPasswordConfirmationModalHandle, PromptPasswordConfirmationModalProps>(
  ({ modalType, onConfirmationSuccess, onConfirmationFailure }, ref) => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [showExplanation, setShowExplanation] = useState(false); // State to toggle between explanation and password input for CREATE_PASSWORD and CREATE_FAKE_STORAGE
    const modalRef = useRef<BottomModalHandle>(null);
    const fadeOutAnimation = useRef(new Animated.Value(1)).current;
    const fadeInAnimation = useRef(new Animated.Value(0)).current;
    const scaleAnimation = useRef(new Animated.Value(1)).current;
    const shakeAnimation = useRef(new Animated.Value(0)).current;
    const explanationOpacity = useRef(new Animated.Value(1)).current;
    const { colors } = useTheme();
    const passwordInputRef = useRef<TextInput>(null);
    const confirmPasswordInputRef = useRef<TextInput>(null);
    const { isVisible } = useKeyboard();

    useImperativeHandle(ref, () => ({
      present: async () => {
        resetState();
        modalRef.current?.present();
        if (modalType === MODAL_TYPES.CREATE_PASSWORD || (modalType === MODAL_TYPES.CREATE_FAKE_STORAGE && !showExplanation)) {
          passwordInputRef.current?.focus();
        } else if (modalType === MODAL_TYPES.ENTER_PASSWORD) {
          passwordInputRef.current?.focus();
        }
      },
      dismiss: async () => {
        await modalRef.current?.dismiss();
        resetState();
      },
    }));

    const resetState = () => {
      setPassword('');
      setConfirmPassword('');
      setIsSuccess(false);
      setIsLoading(false);
      fadeOutAnimation.setValue(1);
      fadeInAnimation.setValue(0);
      scaleAnimation.setValue(1);
      shakeAnimation.setValue(0);
      explanationOpacity.setValue(1);
      setShowExplanation(modalType === MODAL_TYPES.CREATE_PASSWORD);
    };

    useEffect(() => {
      resetState();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modalType]);

    const performShake = (shakeAnimRef: Animated.Value) => {
      Animated.sequence([
        Animated.timing(shakeAnimRef, {
          toValue: 10,
          duration: 100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimRef, {
          toValue: -10,
          duration: 100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimRef, {
          toValue: 5,
          duration: 100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimRef, {
          toValue: -5,
          duration: 100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimRef, {
          toValue: 0,
          duration: 100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    };

    const handleShakeAnimation = () => {
      performShake(shakeAnimation);
    };

    const handleSuccessAnimation = () => {
      // Step 1: Cross-fade current content out and success content in
      Animated.timing(fadeOutAnimation, {
        toValue: 0, // Fade out current content
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        setIsSuccess(true);

        Animated.timing(fadeInAnimation, {
          toValue: 1, // Fade in success content
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start(() => {
          // Step 2: Perform any additional animations like scaling if necessary
          Animated.timing(scaleAnimation, {
            toValue: 1.1,
            duration: 300,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }).start(() => {
            Animated.timing(scaleAnimation, {
              toValue: 1, // Return scale to normal size
              duration: 300,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }).start(() => {
              // Optional delay before dismissing the modal
              setTimeout(async () => {
                await modalRef.current?.dismiss();
              }, 1000);
            });
          });
        });
      });
    };

    const handleConfirmationFailure = () => {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      if (!isSuccess) handleShakeAnimation();
      onConfirmationFailure();
    };

    const handleConfirmSuccess = () => {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      handleSuccessAnimation();
    };

    const handleSubmit = async () => {
      Keyboard.dismiss();
      setIsLoading(true);
      let success = false;

      try {
        if (modalType === MODAL_TYPES.CREATE_PASSWORD || modalType === MODAL_TYPES.CREATE_FAKE_STORAGE) {
          if (password === confirmPassword && password) {
            success = await onConfirmationSuccess(password);
            success ? handleConfirmSuccess() : handleConfirmationFailure();
          } else {
            handleConfirmationFailure();
          }
        } else if (modalType === MODAL_TYPES.ENTER_PASSWORD) {
          success = await onConfirmationSuccess(password);
          success ? handleConfirmSuccess() : handleConfirmationFailure();
        }
      } finally {
        setIsLoading(false); // Ensure loading state is reset
        if (success) {
          // Ensure shake animation is reset before starting the success animation
          shakeAnimation.setValue(0);
        }
      }
    };

    const handleTransitionToCreatePassword = () => {
      Animated.timing(explanationOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShowExplanation(false);
        explanationOpacity.setValue(1); // Reset opacity for when transitioning back
        passwordInputRef.current?.focus();
      });
    };

    const handleCancel = async () => {
      onConfirmationFailure();
      await modalRef.current?.dismiss();
    };

    const animatedViewStyle: Animated.WithAnimatedObject<ViewStyle> = {
      opacity: fadeOutAnimation,
      transform: [{ scale: scaleAnimation }],
      width: '100%',
    };

    const onModalDismiss = () => {
      resetState();
      onConfirmationFailure();
    };

    const isCreating = modalType === MODAL_TYPES.CREATE_PASSWORD || modalType === MODAL_TYPES.CREATE_FAKE_STORAGE;
    const isSubmitDisabled = isLoading || !password || (isCreating && !confirmPassword);
    const opacity = isVisible ? 0 : 1;
    return (
      <BottomModal
        ref={modalRef}
        onClose={onModalDismiss}
        grabber={false}
        showCloseButton={!isSuccess}
        onCloseModalPressed={handleCancel}
        backgroundColor={colors.background}
        isGrabberVisible={!isSuccess}
        dismissible={false}
        detents={['auto']}
        footer={
          !isSuccess ? (
            showExplanation && modalType === MODAL_TYPES.CREATE_PASSWORD ? (
              <Animated.View style={[{ opacity: explanationOpacity }, styles.footer]}>
                <ActionButton
                  title={loc.settings.i_understand}
                  onPress={handleTransitionToCreatePassword}
                  disabled={isLoading}
                  backgroundColor={colors.brandPrimary}
                  color={colors.white}
                  testID="IUnderstandButton"
                />
              </Animated.View>
            ) : (
              <Animated.View
                style={[{ opacity: isVisible ? opacity : fadeOutAnimation, transform: [{ scale: scaleAnimation }] }, styles.footer]}
              >
                <ActionButton
                  title={loc._.ok}
                  onPress={handleSubmit}
                  disabled={isSubmitDisabled}
                  backgroundColor={isSubmitDisabled ? colors.ctaDisabled : colors.brandPrimary}
                  color={colors.white}
                  testID="OKButton"
                />
              </Animated.View>
            )
          ) : null
        }
      >
        {!isSuccess && (
          <Animated.View style={[animatedViewStyle, styles.content]}>
            {modalType === MODAL_TYPES.CREATE_PASSWORD && showExplanation && (
              <Animated.View style={{ opacity: explanationOpacity }}>
                <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.settings.encrypt_storage_explanation_headline}</Text>
                <Text style={[styles.description, { color: colors.textMuted }]} maxFontSizeMultiplier={1.2}>
                  {loc.settings.encrypt_storage_explanation_description_line1}
                </Text>
                <Text style={[styles.description, { color: colors.textMuted }]} maxFontSizeMultiplier={1.2}>
                  {loc.settings.encrypt_storage_explanation_description_line2}
                </Text>
              </Animated.View>
            )}
            {(modalType === MODAL_TYPES.ENTER_PASSWORD || (isCreating && !showExplanation)) && (
              <>
                <Text style={[styles.title, { color: colors.textPrimary }]}>
                  {modalType === MODAL_TYPES.ENTER_PASSWORD ? loc._.enter_password : loc.settings.password_explain}
                </Text>
                {modalType === MODAL_TYPES.CREATE_FAKE_STORAGE && (
                  <Text style={[styles.description, { color: colors.textMuted }]}>
                    {loc.plausibledeniability.create_password_explanation}
                  </Text>
                )}
                <Animated.View style={[styles.fields, { transform: [{ translateX: shakeAnimation }] }]}>
                  <LabeledField label={loc.settings.password}>
                    <FieldTextInput
                      testID="PasswordInput"
                      ref={passwordInputRef}
                      secureTextEntry
                      value={password}
                      autoCapitalize="none"
                      autoComplete="off"
                      autoCorrect={false}
                      onChangeText={setPassword}
                      clearTextOnFocus
                      clearButtonMode="while-editing"
                      autoFocus
                    />
                  </LabeledField>
                  {isCreating && (
                    <LabeledField label={loc.settings.password_confirm}>
                      <FieldTextInput
                        testID="ConfirmPasswordInput"
                        ref={confirmPasswordInputRef}
                        secureTextEntry
                        value={confirmPassword}
                        clearTextOnFocus
                        autoCorrect={false}
                        autoComplete="off"
                        autoCapitalize="none"
                        clearButtonMode="while-editing"
                        onChangeText={setConfirmPassword}
                      />
                    </LabeledField>
                  )}
                </Animated.View>
              </>
            )}
          </Animated.View>
        )}
        {isSuccess && (
          <Animated.View style={[styles.successContainer, { opacity: fadeInAnimation, transform: [{ scale: scaleAnimation }] }]}>
            <View style={[styles.checkCircle, { backgroundColor: colors.surfaceSubtle }]}>
              <CheckmarkIcon size={32} color={colors.brandPrimary} />
            </View>
          </Animated.View>
        )}
      </BottomModal>
    );
  },
);

export default PromptPasswordConfirmationModal;

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontFamily: ClashFont.medium,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontFamily: ClashFont.regular,
    fontSize: 15,
    lineHeight: 22.5,
    textAlign: 'center',
    marginBottom: 12,
  },
  fields: {
    gap: 16,
    marginTop: 12,
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  successContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 48,
  },
  checkCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
