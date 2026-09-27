import { expectToBeVisible, helperAddContact, helperCreateWallet, launchAppForE2E, waitForId } from './helperz';

const ADDR_A = 'sp1qqfqnnv8czppwysafq3uwgwvsc638hc8rx3hscuddh0xa2yd746s7xqh6yy9ncjnqhqxazct0fzh98w7lpkm5fvlepqec2yy0sxlq4j6ccc3h6t0g';
const ADDR_B = 'sp1qqvchcnrcqpdutxhpf57ptn3wajj0ymqxwzu9g6vj9uxx3wuvlykhyqh99hyh33y5593802pzw5rtw040zrw9f8re52tgcwngc5974w5evuufdy0m';

// Copied from loc/en.json rather than imported: pulling loc/ into the detox runner would drag the
// whole react-native module graph into a plain node process.
const ADDRESS_INVALID = "That doesn't look like a valid address";
const ADDRESS_VALID = 'Valid silent payment address';
const REMOVE_CONFIRM = 'Remove';

const returnToHome = async () => {
  for (let i = 0; i < 4; i++) {
    if (await expectToBeVisible('HomeScreenReceiveButton')) return;
    await device.pressBack();
  }
  await waitForId('HomeScreenReceiveButton');
};

describe('Contacts', () => {
  beforeAll(async () => {
    await launchAppForE2E({ delete: true });
    await helperCreateWallet();
  });

  it('shows the empty state on the home Contacts tab', async () => {
    await element(by.id('HomeTab-1')).tap();
    // The empty state is the list footer, below a wallet header taller than a phone screen, so it
    // only comes into view once the home list is scrolled. Scrolling to the button rather than the
    // card guarantees the card's bottom edge cleared the fold too.
    await waitFor(element(by.id('ContactsEmptyAddButton')))
      .toBeVisible()
      .whileElement(by.id('WalletsListScrollView'))
      .scroll(200, 'down');
    await expect(element(by.id('NoContactsMessage'))).toBeVisible();
  });

  it('rejects an invalid address and accepts a valid one', async () => {
    await element(by.id('ContactsEmptyAddButton')).tap();
    await waitFor(element(by.id('ContactNameInput')))
      .toBeVisible()
      .withTimeout(15_000);

    await element(by.id('ContactNameInput')).replaceText('Anmol');
    await element(by.id('ContactAddressInput')).replaceText('not-an-address');
    await waitFor(element(by.text(ADDRESS_INVALID)))
      .toBeVisible()
      .withTimeout(5_000);

    // the save button is disabled while errors stand, so tapping it has to be a no-op.
    await element(by.id('ContactSaveButton')).tap();
    await expect(element(by.id('ContactAddressInput'))).toBeVisible();

    await element(by.id('ContactAddressInput')).replaceText(ADDR_A);
    await waitFor(element(by.text(ADDRESS_VALID)))
      .toBeVisible()
      .withTimeout(5_000);
  });

  it('adds the contact and shows it on the home tab', async () => {
    await element(by.id('ContactSaveButton')).tap();

    await waitFor(element(by.id(`HomeContact-${ADDR_A}`)))
      .toBeVisible()
      .withTimeout(15_000);
    // the empty state replaces the whole list body, so a stale one left behind is a real failure.
    await expect(element(by.id('NoContactsMessage'))).not.toBeVisible();
  });

  it('refuses to save a second contact on the same address', async () => {
    await element(by.id('HomeAddContactButton')).tap();
    await waitFor(element(by.id('ContactNameInput')))
      .toBeVisible()
      .withTimeout(15_000);
    await element(by.id('ContactNameInput')).replaceText('Dup');
    await element(by.id('ContactAddressInput')).replaceText(ADDR_A);

    await waitFor(element(by.id('ContactAddressMessage')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.id('ContactSaveButton')).tap();
    await expect(element(by.id('ContactAddressInput'))).toBeVisible();

    await device.pressBack();
    await waitForId(`HomeContact-${ADDR_A}`);
  });

  it('opens contact detail from the home tab', async () => {
    await element(by.id(`HomeContact-${ADDR_A}`)).tap();
    await waitFor(element(by.id('ContactPayButton')))
      .toBeVisible()
      .withTimeout(15_000);
    await expect(element(by.text(ADDR_A))).toBeVisible();
    // Remove is held against the foot of the form, past the fold on a short screen.
    await waitFor(element(by.id('ContactRemoveButton')))
      .toBeVisible()
      .whileElement(by.id('ContactDetailScrollView'))
      .scroll(200, 'down');
  });

  it('edits the contact name', async () => {
    await element(by.id('ContactEditButton')).tap();
    await waitFor(element(by.id('ContactNameInput')))
      .toBeVisible()
      .withTimeout(15_000);
    await element(by.id('ContactNameInput')).replaceText('Anmol Sharma');
    await element(by.id('ContactSaveButton')).tap();

    await waitFor(element(by.text('Anmol Sharma')))
      .toBeVisible()
      .withTimeout(15_000);
  });

  it('opens the send flow from Pay with the address prefilled', async () => {
    await device.disableSynchronization();
    try {
      await element(by.id('ContactPayButton')).tap();
      await waitFor(element(by.id('AddressInput')))
        .toBeVisible()
        .withTimeout(30_000);
      await expect(element(by.id('AddressInput'))).toHaveText(ADDR_A);
    } finally {
      await device.enableSynchronization();
    }
  });

  it('picks a contact from the send screen', async () => {
    await device.disableSynchronization();
    try {
      await element(by.id('AddressInput')).replaceText('');
      await waitFor(element(by.id('SendDetailsContactsButton')))
        .toBeVisible()
        .withTimeout(10_000);

      await element(by.id('SendDetailsContactsButton')).tap();
      // TrueSheet reports the sheet's content as children of its host view as well as of the
      // sheet itself, so Espresso finds every view in the sheet twice. Both matches are the same view.
      await waitFor(element(by.id(`PickContact-${ADDR_A}`)).atIndex(0))
        .toBeVisible()
        .withTimeout(10_000);

      await element(by.id(`PickContact-${ADDR_A}`)).atIndex(0).tap();
      await waitFor(element(by.id('AddressInput')))
        .toHaveText(ADDR_A)
        .withTimeout(10_000);

      // a saved payee is named by the chip, and offered no redundant save affordance
      await expect(element(by.id('SendDetailsContactChip'))).toBeVisible();
      await expect(element(by.text('to Anmol Sharma'))).toBeVisible();
      await expect(element(by.id('SaveContactButton'))).not.toBeVisible();
    } finally {
      await device.enableSynchronization();
    }

    await returnToHome();
  });

  it('filters the contact list from settings', async () => {
    await helperAddContact('Zeref', ADDR_B);
    await waitForId(`HomeContact-${ADDR_B}`);

    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('ContactsButton')))
      .toBeVisible()
      .withTimeout(10_000);
    await element(by.id('ContactsButton')).tap();

    await waitFor(element(by.id('ContactSearchInput')))
      .toBeVisible()
      .withTimeout(10_000);
    await expect(element(by.id(`ContactListContact-${ADDR_A}`))).toBeVisible();
    await expect(element(by.id(`ContactListContact-${ADDR_B}`))).toBeVisible();

    await element(by.id('ContactSearchInput')).replaceText('zer');
    await waitFor(element(by.id(`ContactListContact-${ADDR_A}`)))
      .not.toBeVisible()
      .withTimeout(5_000);
    await expect(element(by.id(`ContactListContact-${ADDR_B}`))).toBeVisible();

    await element(by.id('ContactSearchInput')).replaceText('');
    await waitFor(element(by.id(`ContactListContact-${ADDR_A}`)))
      .toBeVisible()
      .withTimeout(5_000);
  });

  it('removes a contact', async () => {
    await element(by.id(`ContactListContact-${ADDR_B}`)).tap();
    await waitFor(element(by.id('ContactRemoveButton')))
      .toBeVisible()
      .whileElement(by.id('ContactDetailScrollView'))
      .scroll(200, 'down');
    await element(by.id('ContactRemoveButton')).tap();

    await waitFor(element(by.text(REMOVE_CONFIRM)))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.text(REMOVE_CONFIRM)).tap();

    await waitFor(element(by.id(`ContactListContact-${ADDR_B}`)))
      .not.toExist()
      .withTimeout(15_000);
    await expect(element(by.id(`ContactListContact-${ADDR_A}`))).toBeVisible();
  });

  // ADDR_B is unsaved again by now, so the send screen offers to save it.
  it('saves an unsaved address as a contact from the send screen', async () => {
    await returnToHome();
    await element(by.id('HomeTab-1')).tap();
    await waitForId(`HomeContact-${ADDR_A}`);
    await element(by.id(`HomeContact-${ADDR_A}`)).tap();
    await waitFor(element(by.id('ContactPayButton')))
      .toBeVisible()
      .withTimeout(15_000);

    await device.disableSynchronization();
    try {
      await element(by.id('ContactPayButton')).tap();
      await waitFor(element(by.id('AddressInput')))
        .toBeVisible()
        .withTimeout(30_000);

      await element(by.id('AddressInput')).replaceText(ADDR_B);
      // The save row sits below the amount hero and address field, past the fold on a short screen.
      await waitFor(element(by.id('SaveContactButton')))
        .toBeVisible()
        .whileElement(by.id('SendDetailsScrollView'))
        .scroll(200, 'down');

      await element(by.id('SaveContactButton')).tap();
      // already capitalised, so the field's autoCapitalize="words" cannot change what was typed
      await element(by.id('SaveContactNameInput')).typeText('Tanveer');
      // blur cancels now, so committing goes through the button rather than tapping away
      await element(by.id('SaveContactConfirmButton')).tap();

      // the green receipt is deliberately short-lived, so assert what the save leaves behind:
      // the address is now named by the chip, and has no save affordance left to offer
      await waitFor(element(by.id('SendDetailsContactChip')))
        .toBeVisible()
        .withTimeout(10_000);
      await expect(element(by.text('to Tanveer'))).toBeVisible();
      await expect(element(by.id('SaveContactButton'))).not.toBeVisible();
    } finally {
      await device.enableSynchronization();
    }

    await returnToHome();
  });

  it('keeps contacts across an app restart', async () => {
    await launchAppForE2E({ delete: false });
    await waitFor(element(by.id('HomeScreenReceiveButton')))
      .toBeVisible()
      .withTimeout(30_000);

    await element(by.id('HomeTab-1')).tap();
    await waitFor(element(by.id(`HomeContact-${ADDR_A}`)))
      .toBeVisible()
      .withTimeout(15_000);
  });

  // Changing the address rekeys the contact, leaving the detail screen under the form holding a
  // stale route param. Backing out of the saved contact has to reach home, not the form again.
  it('returns home from a contact whose address was edited', async () => {
    // ADDR_B belongs to Tanveer until removed, and a duplicate address will not save.
    await element(by.id(`HomeContact-${ADDR_B}`)).tap();
    await waitFor(element(by.id('ContactRemoveButton')))
      .toBeVisible()
      .whileElement(by.id('ContactDetailScrollView'))
      .scroll(200, 'down');
    await element(by.id('ContactRemoveButton')).tap();
    await waitFor(element(by.text(REMOVE_CONFIRM)))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.text(REMOVE_CONFIRM)).tap();

    await waitForId(`HomeContact-${ADDR_A}`);
    await element(by.id(`HomeContact-${ADDR_A}`)).tap();
    await waitFor(element(by.id('ContactEditButton')))
      .toBeVisible()
      .withTimeout(15_000);
    await element(by.id('ContactEditButton')).tap();
    await waitFor(element(by.id('ContactAddressInput')))
      .toBeVisible()
      .withTimeout(15_000);
    await element(by.id('ContactAddressInput')).replaceText(ADDR_B);
    await element(by.id('ContactSaveButton')).tap();

    // the same detail screen rekeyed, not a second one stacked on top of the form
    await waitFor(element(by.text(ADDR_B)))
      .toBeVisible()
      .withTimeout(15_000);
    await device.pressBack();
    await waitForId('HomeScreenReceiveButton');
  });
});
