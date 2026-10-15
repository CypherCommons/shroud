import { sha256 } from '@noble/hashes/sha256';
import { element } from 'detox';

export async function waitForId(id, timeout = 33000) {
  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout / 2);
  } catch (_) {
    // nop
  }

  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout / 2);
    return true;
  } catch (_) {
    const msg = `Assertion failed: testID ${id} is not visible`;
    throw new Error(msg);
  }
}

export async function waitForText(text, timeout = 33000) {
  try {
    await waitFor(element(by.text(text)))
      .toBeVisible()
      .withTimeout(timeout / 2);
    return true;
  } catch (_) {
    // nop
  }

  try {
    await waitFor(element(by.text(text)))
      .toBeVisible()
      .withTimeout(timeout / 2);
    return true;
  } catch (_) {
    const msg = `Assertion failed: text "${text}" is not visible`;
    throw new Error(msg);
  }
}

export async function getSwitchValue(switchId) {
  try {
    await expect(element(by.id(switchId))).toHaveToggleValue(true);
    return true;
  } catch (_) {
    return false;
  }
}

export async function launchAppForE2E({ delete: del = true } = {}) {
  await device.launchApp({
    delete: del,
    newInstance: true,
    launchArgs: { detoxE2E: true },
  });
}

export async function helperCreateWallet() {
  await device.disableSynchronization();
  try {
    await waitFor(element(by.id('CreateWallet')))
      .toBeVisible()
      .withTimeout(60_000);
    await element(by.id('CreateWallet')).tap();
    await waitFor(element(by.id('PleaseBackupScrollView')))
      .toBeVisible()
      .withTimeout(15_000);
    for (let i = 0; i < 5; i++) {
      await element(by.id('SkipVerifyBackdoor')).tap();
    }
    await waitFor(element(by.id('HomeScreenReceiveButton')))
      .toBeVisible()
      .withTimeout(15_000);
  } finally {
    await device.enableSynchronization();
  }
}

export async function helperImportWallet(mnemonic, { birthDate } = {}) {
  await device.disableSynchronization();
  try {
    await waitFor(element(by.id('ImportWallet')))
      .toBeVisible()
      .withTimeout(60_000);
    await element(by.id('ImportWallet')).tap();
    await waitFor(element(by.id('MnemonicWordInput1')))
      .toBeVisible()
      .withTimeout(15_000);
    // The whole phrase goes into the first pill, which spreads it over the grid the way a paste does.
    await element(by.id('MnemonicWordInput1')).replaceText(mnemonic);
    // Restore is enabled in the same render that puts the last word in its pill, so wait for that:
    // with synchronization off, a tap straight after replaceText can land on a still-disabled button.
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    await waitFor(element(by.id(`MnemonicWordInput${words.length}`)))
      .toHaveText(words[words.length - 1])
      .withTimeout(15_000);
    if (birthDate) {
      await waitFor(element(by.id('BirthDateInput')))
        .toBeVisible()
        .whileElement(by.id('ImportWalletScrollView'))
        .scroll(200, 'down');
      await element(by.id('BirthDateInput')).replaceText(birthDate);
    }
    // A 24-word grid pushes the footer below the fold on smaller screens.
    await waitFor(element(by.id('DoImport')))
      .toBeVisible()
      .whileElement(by.id('ImportWalletScrollView'))
      .scroll(200, 'down');
    // Android drops a touch that lands while the scroll view is still settling, from that scroll or
    // from the keyboard the paste dismissed.
    await sleep(1_000);
    await element(by.id('DoImport')).tap();
    await waitFor(element(by.id('RestoreSuccessDoneButton')))
      .toBeVisible()
      .withTimeout(60_000);
    await element(by.id('RestoreSuccessDoneButton')).tap();
    await waitFor(element(by.id('HomeScreenReceiveButton')))
      .toBeVisible()
      .withTimeout(60_000);
  } finally {
    await device.enableSynchronization();
  }
}

// Fills in and saves the ContactEdit form. `via` is the testID of whichever button opens it —
// the home tab's "+ Add", the empty state's CTA and the list header's "+" all land on the same
// screen, so the caller only has to say which door it walked through.
export async function helperAddContact(name, address, { via = 'HomeAddContactButton' } = {}) {
  await element(by.id(via)).tap();
  await waitFor(element(by.id('ContactNameInput')))
    .toBeVisible()
    .withTimeout(15_000);
  await element(by.id('ContactNameInput')).replaceText(name);
  // replaceText rather than typeText: a silent payment address is ~117 characters, and synthesizing
  // that many key events is both slow and a reliable source of dropped characters.
  await element(by.id('ContactAddressInput')).replaceText(address);
  await element(by.id('ContactSaveButton')).tap();
}

// Dismisses the "Have you saved your wallet's backup phrase?" Alert that fires
// the first time a fresh wallet navigates to an export-gated screen (e.g.
// Receive). Test-side equivalent of a user clicking "Yes, I have." Silently
// no-ops if the dialog isn't shown.
export async function dismissBackupReminderIfPresent({ timeout = 5_000 } = {}) {
  try {
    await waitFor(element(by.text('Yes, I have.')))
      .toBeVisible()
      .withTimeout(timeout);
    await element(by.text('Yes, I have.')).tap();
  } catch (_) {
    // dialog not shown
  }
}

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Scrolls until the view is on screen, then lets the list settle before anything touches it: on
// Android 12+ a list scrolled into its end stretches, and the next touch goes to the list to catch
// that stretch instead of to the view under the finger.
export async function scrollIntoView(testID, scrollViewID, visiblePercent = 75) {
  await waitFor(element(by.id(testID)))
    .toBeVisible(visiblePercent)
    .whileElement(by.id(scrollViewID))
    .scroll(200, 'down');
  await sleep(1_000);
}

export function hashIt(s) {
  return Buffer.from(sha256(s)).toString('hex');
}

/**
 * a hack to extract element text. warning, this might break in future
 * @see https://github.com/wix/detox/issues/445
 *
 * @returns {Promise<string>}
 */
export async function extractTextFromElementById(id) {
  try {
    await expect(element(by.id(id))).toHaveText('_unfoundable_text');
  } catch (error) {
    if (device.getPlatform() === 'ios') {
      const start = `accessibilityLabel was "`;
      const end = '" on ';
      const errorMessage = error.message.toString();
      const [, restMessage] = errorMessage.split(start);
      const [label] = restMessage.split(end);
      return label;
    } else {
      const start = 'Got:';
      const end = '}"';
      const errorMessage = error.message.toString();
      const [, restMessage] = errorMessage.split(start);
      const [label] = restMessage.split(end);
      const value = label.split(',');
      const combineText = value.find(i => i.includes('text=')).trim();
      const [, elementText] = combineText.split('=');
      return elementText;
    }
  }
}

export const expectToBeVisible = async id => {
  try {
    await expect(element(by.id(id))).toBeVisible();
    return true;
  } catch (e) {
    return false;
  }
};

export async function tapAndTapAgainIfElementIsNotVisible(idToTap, idToCheckVisible) {
  // tap
  await element(by.id(idToTap)).tap();

  // check if visible
  try {
    await waitFor(element(by.id(idToCheckVisible)))
      .toBeVisible()
      .withTimeout(3_000);
    return; // did not throw? its visible, return
  } catch (_) {}

  // did not return so its not visible, lets tap again
  await element(by.id(idToTap)).tap();

  // check visibility again, this time no try-catch, if it fails it fails
  await waitFor(element(by.id(idToCheckVisible)))
    .toBeVisible()
    .withTimeout(3_000);
}

export async function tapIfPresent(id) {
  try {
    await element(by.id(id)).tap();
  } catch (_) {}
  // no need to check for visibility, just silently ignore exception if such testID is not present
}

export async function tapIfTextPresent(text) {
  try {
    await element(by.text(text)).tap();
  } catch (_) {}
  // no need to check for visibility, just silently ignore exception if such testID is not present
}

export async function countElements(testId) {
  let count = 0;
  while (true) {
    try {
      await expect(element(by.id(testId)).atIndex(count)).toExist();
      count++;
    } catch (_) {
      break;
    }
  }
  return count;
}

export async function scanText(text) {
  await sleep(5000); // wait for camera screen to initialize
  await waitForId('ScanQrBackdoorButton');
  for (let c = 0; c <= 5; c++) {
    await element(by.id('ScanQrBackdoorButton')).tap();
  }
  await element(by.id('scanQrBackdoorInput')).replaceText(text);
  await element(by.id('scanQrBackdoorOkButton')).tap();
}

export async function scanFromHome(text) {
  await element(by.id('HomeScreenScanButton')).tap();
  await scanText(text);
}
