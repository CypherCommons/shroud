import { enqueueDialog } from '../components/Dialog/dialogStore';
import loc from '../loc';

type PromptInputType = 'plain-text' | 'secure-text' | 'numeric';

/** Asks for a line of text in the app's dialog. Resolves with the text, rejects when cancelled. */
export default (
  title: string,
  text: string,
  isCancelable = true,
  type: PromptInputType = 'secure-text',
  isOKDestructive = false,
  continueButtonText = loc._.ok,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('Cancel Pressed'));
    const confirm = {
      text: continueButtonText,
      style: isOKDestructive ? 'destructive' : 'default',
      onPress: (value = '') => resolve(value),
    } as const;

    enqueueDialog({
      title,
      message: text,
      input: { secure: type === 'secure-text', numeric: type === 'numeric' },
      buttons: isCancelable ? [{ text: loc._.cancel, style: 'cancel', onPress: cancel }, confirm] : [confirm],
      cancelable: isCancelable,
      onDismiss: cancel,
    });
  });
