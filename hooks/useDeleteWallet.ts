import { useCallback } from 'react';
import { CommonActions } from '@react-navigation/native';
import { useStorage } from './context/useStorage';
import { useProtectedAction } from './useProtectedAction';
import { useExtendedNavigation } from './useExtendedNavigation';
import loc from '../loc';
import presentAlert from '../components/Alert';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';

/**
 * Delete-wallet flow: confirm, then the same biometrics-or-PIN check as revealing the recovery phrase.
 * While the PIN is asked for, `isPinPromptVisible` is true and the screen shows a <PinPrompt> with `pinAttempt`.
 */
export const useDeleteWallet = () => {
  const { wallets, handleWalletDeletion } = useStorage();
  const { runProtected, isPinPromptVisible, pinAttempt } = useProtectedAction();
  const navigation = useExtendedNavigation();

  const deleteWallet = useCallback(() => {
    const wallet = wallets[0];
    if (!wallet) return;

    presentAlert({
      title: loc.wallets.details_delete_wallet,
      message: loc.wallets.details_delete_wallet_message,
      buttons: [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc.wallets.details_yes_delete,
          style: 'destructive',
          onPress: () =>
            runProtected(async () => {
              const ok = await handleWalletDeletion(wallet.getID());
              if (ok) {
                triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
                navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Onboarding' }] }));
              }
            }),
        },
      ],
      options: { cancelable: false },
    });
  }, [wallets, handleWalletDeletion, runProtected, navigation]);

  return { deleteWallet, isPinPromptVisible, pinAttempt };
};
