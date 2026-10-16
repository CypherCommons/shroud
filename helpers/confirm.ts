import presentAlert from '../components/Alert';
import loc from '../loc';

/** Asks Yes/Cancel in a dialog that can't be dismissed. Resolves true on Yes. */
export default (title: string, text: string): Promise<boolean> =>
  new Promise(resolve => {
    presentAlert({
      title,
      message: text,
      buttons: [
        { text: loc._.yes, onPress: () => resolve(true), style: 'default' },
        { text: loc._.cancel, onPress: () => resolve(false), style: 'cancel' },
      ],
      options: { cancelable: false },
    });
  });
