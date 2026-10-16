import presentAlert from '../components/Alert';
import loc from '../loc';

export const presentWalletExportReminder = (): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    presentAlert({
      title: loc.wallets.details_title,
      message: loc.pleasebackup.ask,
      buttons: [
        { text: loc.pleasebackup.ask_yes, onPress: () => resolve(), style: 'default' },
        { text: loc.pleasebackup.ask_no, onPress: () => reject(new Error('User has denied saving the wallet backup.')) },
        { text: loc._.cancel, style: 'cancel' },
      ],
      options: { cancelable: true },
    });
  });
};
