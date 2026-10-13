import { dismissBackupReminderIfPresent, helperCreateWallet, launchAppForE2E } from './helperz';

describe('Receive', () => {
  beforeAll(async () => {
    await launchAppForE2E({ delete: true });
    await helperCreateWallet();
  });

  it('navigates from home to the Receive screen', async () => {
    await element(by.id('HomeScreenReceiveButton')).tap();
    await dismissBackupReminderIfPresent();
    await waitFor(element(by.id('ReceiveDetailsScrollView')))
      .toBeVisible()
      .withTimeout(15_000);
  });

  it('renders an address', async () => {
    await waitFor(element(by.id('AddressCopyCard')))
      .toExist()
      .withTimeout(15_000);
  });

  it('fits the screen, so Share shows without scrolling', async () => {
    await expect(element(by.id('ReceiveShareButton'))).toBeVisible();
  });
});
