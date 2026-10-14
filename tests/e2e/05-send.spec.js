import { SP_MAINNET } from '../fixtures/addresses';
import { dismissBackupReminderIfPresent, helperCreateWallet, launchAppForE2E, scanFromHome, waitForId } from './helperz';

describe('Send', () => {
  beforeAll(async () => {
    await launchAppForE2E({ delete: true });
    await helperCreateWallet();
  });

  it('scanning a silent payment address on home opens Send prefilled', async () => {
    // SendDetails keeps detox busy, as in 07-contacts' send-flow tests.
    await device.disableSynchronization();
    try {
      await scanFromHome(SP_MAINNET);
      await waitFor(element(by.id('AddressInput')))
        .toBeVisible()
        .withTimeout(30_000);
      await expect(element(by.id('AddressInput'))).toHaveText(SP_MAINNET);
    } finally {
      await device.enableSynchronization();
    }
    await device.pressBack();
    await waitForId('HomeScreenReceiveButton');
  });

  it('shows zero-balance toast when tapping Send with no funds', async () => {
    await element(by.id('HomeScreenSendButton')).tap();
    await waitFor(element(by.id('ZeroBalanceToast')))
      .toBeVisible()
      .withTimeout(5_000);
  });

  it('navigates to Receive screen via toast Request button', async () => {
    await waitFor(element(by.id('ZeroBalanceToastRequestButton')))
      .not.toExist()
      .withTimeout(10_000);
    await element(by.id('HomeScreenSendButton')).tap();
    await waitFor(element(by.id('ZeroBalanceToastRequestButton')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.id('ZeroBalanceToastRequestButton')).tap();
    await dismissBackupReminderIfPresent();
    await waitFor(element(by.id('ReceiveDetailsScrollView')))
      .toBeVisible()
      .withTimeout(15_000);
  });
});
