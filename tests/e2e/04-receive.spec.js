import { dismissBackupReminderIfPresent, helperCreateWallet, launchAppForE2E, scrollIntoView } from './helperz';

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

  it('keeps Share on screen without scrolling', async () => {
    await expect(element(by.id('ReceiveShareButton'))).toBeVisible();
  });

  it('inspects the full address in a sheet', async () => {
    // On a short screen like CI's 320x640 emulator the QR is at its smallest and the content still
    // runs under Share, so the address card has to be scrolled up first.
    await scrollIntoView('AddressCopyCardInspectButton', 'ReceiveDetailsScrollView');
    await element(by.id('AddressCopyCardInspectButton')).tap();
    // TrueSheet reports the sheet's content as children of its host view as well as of the
    // sheet itself, so Espresso finds every view in the sheet twice. Both matches are the same view.
    // The button is the last of the sheet to slide into view, so waiting on it waits out the slide.
    await waitFor(element(by.id('InspectAddressCopyButton')).atIndex(0))
      .toBeVisible()
      .withTimeout(10_000);
    await element(by.id('InspectAddressCopyButton')).atIndex(0).tap();

    await device.pressBack();
    await waitFor(element(by.id('InspectAddressSheet')).atIndex(0))
      .not.toBeVisible()
      .withTimeout(10_000);
  });
});
