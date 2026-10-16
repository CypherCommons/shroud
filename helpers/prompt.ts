import { enqueueDialog } from '../components/Dialog/dialogStore';
import loc from '../loc';

/**
 * Asks for a password in the app's dialog. Resolves with the text, rejects when cancelled.
 * Needs DialogHost mounted: unlike presentAlert there is no system fallback, so the promise waits for it.
 */
export default (title: string, text: string, isCancelable = true): Promise<string> =>
  new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('Cancel Pressed'));
    const confirm = { text: loc._.ok, onPress: (value = '') => resolve(value) };

    enqueueDialog({
      title,
      message: text,
      input: { secure: true },
      buttons: isCancelable ? [{ text: loc._.cancel, style: 'cancel', onPress: cancel }, confirm] : [confirm],
      cancelable: isCancelable,
      onDismiss: cancel,
    });
  });
