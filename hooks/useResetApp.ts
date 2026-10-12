import { useCallback } from 'react';
import presentAlert from '../components/Alert';
import { useStorage } from './context/useStorage';
import { useContacts } from './context/useContacts';
import { useBiometrics } from './useBiometrics';
import loc from '../loc';

/**
 * Forgot-PIN reset, offered on the lock screens after repeated wrong PINs. Asks for confirmation, then
 * deletes the wallet and unlock settings from this device; the user restores with their recovery phrase.
 * The app never does this on its own. `onReset` moves the UI on once the wipe is done.
 */
export const useResetApp = (onReset: () => void) => {
  const { wipeDevice } = useStorage();
  const { resetContacts } = useContacts();
  const { setBiometricUseEnabled } = useBiometrics();

  return useCallback(() => {
    presentAlert({
      title: loc.settings.pin_reset_title,
      message: loc.settings.pin_reset_message,
      buttons: [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc.settings.pin_reset_confirm,
          style: 'destructive',
          onPress: async () => {
            try {
              await wipeDevice();
              await setBiometricUseEnabled(false);
              resetContacts();
              onReset();
            } catch (e) {
              console.warn('reset failed:', e);
              presentAlert({ message: loc.settings.pin_storage_error });
            }
          },
        },
      ],
      options: { cancelable: false },
    });
  }, [wipeDevice, setBiometricUseEnabled, resetContacts, onReset]);
};
