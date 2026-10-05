import { Alert as RNAlert, Platform, AlertButton, AlertOptions } from 'react-native';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';
import loc from '../loc';
import { navigationRef } from '../NavigationService';
import { enqueueDialog, isDialogHostMounted } from './Dialog/dialogStore';

const presentAlert = (() => {
  let lastAlertParams: {
    title?: string;
    message: string;
    hapticFeedback?: HapticFeedbackTypes;
    buttons?: AlertButton[];
    options?: AlertOptions;
  } | null = null;

  const clearCache = () => {
    lastAlertParams = null;
  };

  const showAlert = (title: string | undefined, message: string, buttons: AlertButton[], options: AlertOptions) => {
    // The themed dialog once the app UI is up; the system alert only before that.
    if (isDialogHostMounted()) {
      enqueueDialog({
        title,
        message,
        buttons: buttons.map(b => ({ text: b.text ?? '', style: b.style, onPress: b.onPress })),
        cancelable: options.cancelable,
        onDismiss: options.onDismiss,
      });
      return;
    }
    if (Platform.OS === 'ios' && navigationRef.isReady()) {
      RNAlert.alert(title ?? message, title && message ? message : undefined, buttons, options);
    } else {
      RNAlert.alert(title ?? '', message, buttons, options);
    }
  };

  return ({
    title,
    message,
    hapticFeedback,
    buttons = [],
    options = { cancelable: false },
    allowRepeat = true,
  }: {
    title?: string;
    message: string;
    hapticFeedback?: HapticFeedbackTypes;
    buttons?: AlertButton[];
    options?: AlertOptions;
    allowRepeat?: boolean;
  }) => {
    const currentAlertParams = { title, message, hapticFeedback, buttons, options };

    if (!allowRepeat && lastAlertParams && JSON.stringify(lastAlertParams) === JSON.stringify(currentAlertParams)) {
      return;
    }

    if (JSON.stringify(lastAlertParams) !== JSON.stringify(currentAlertParams)) {
      clearCache();
    }

    lastAlertParams = currentAlertParams;

    if (hapticFeedback) {
      triggerHapticFeedback(hapticFeedback);
    }

    const wrappedButtons: AlertButton[] = buttons.length > 0 ? buttons : [{ text: loc._.ok, onPress: () => {}, style: 'default' }];

    showAlert(title, message, wrappedButtons, options);
  };
})();

export default presentAlert;
