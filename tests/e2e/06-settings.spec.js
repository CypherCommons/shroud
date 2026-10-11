import { helperCreateWallet, launchAppForE2E } from './helperz';

describe('Settings', () => {
  beforeAll(async () => {
    await launchAppForE2E({ delete: true });
    await helperCreateWallet();
  });

  it('navigates through visible settings entries', async () => {
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('CurrencyButton')))
      .toBeVisible()
      .withTimeout(10_000);

    await element(by.id('CurrencyButton')).tap();
    await device.pressBack();
    await waitFor(element(by.id('AboutButton')))
      .toBeVisible()
      .whileElement(by.id('SettingsScrollView'))
      .scroll(200, 'down');

    await element(by.id('AboutButton')).tap();
    await waitFor(element(by.id('AboutScrollView')))
      .toBeVisible()
      .withTimeout(5_000);

    await waitFor(element(by.id('LicenseRow')))
      .toBeVisible()
      .whileElement(by.id('AboutScrollView'))
      .scroll(200, 'down');
    await element(by.id('LicenseRow')).tap();
    await waitFor(element(by.id('LicensingScrollView')))
      .toBeVisible()
      .withTimeout(5_000);
    await device.pressBack();

    await device.pressBack();
    await device.pressBack();
    await waitFor(element(by.id('SettingsButton')))
      .toBeVisible()
      .withTimeout(5_000);
  });

  it('toggles general settings and changes theme and denomination', async () => {
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('GeneralButton')))
      .toBeVisible()
      .withTimeout(10_000);

    await element(by.id('GeneralButton')).tap();
    await waitFor(element(by.id('GeneralSettingsScrollView')))
      .toBeVisible()
      .withTimeout(10_000);

    await waitFor(element(by.id('CrashReportsSwitch')))
      .toBeVisible()
      .whileElement(by.id('GeneralSettingsScrollView'))
      .scroll(200, 'down');
    // Turn crash reports off and back on. The switch is a Pressable (components/Toggle.tsx), not an
    // Android Checkable, so Detox can't read its value with toHaveToggleValue.
    await element(by.id('CrashReportsSwitch')).tap();
    await element(by.id('CrashReportsSwitch')).tap();

    await waitFor(element(by.id('ThemeRow')))
      .toBeVisible()
      .whileElement(by.id('GeneralSettingsScrollView'))
      .scroll(200, 'down');
    await element(by.id('ThemeRow')).tap();
    await waitFor(element(by.id('ThemeDarkOption')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.id('ThemeDarkOption')).tap();
    await device.pressBack();

    await waitFor(element(by.id('DenominationRow')))
      .toBeVisible()
      .whileElement(by.id('GeneralSettingsScrollView'))
      .scroll(200, 'down');
    await element(by.id('DenominationRow')).tap();
    await waitFor(element(by.id('DenominationSatsOption')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.id('DenominationSatsOption')).tap();
    await device.pressBack();
  });
});
