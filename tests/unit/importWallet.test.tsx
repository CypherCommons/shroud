import assert from 'assert';
import React from 'react';
import { Keyboard, TextInput } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import ImportWallet from '../../screen/wallets/ImportWallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useSettings } from '../../hooks/context/useSettings';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { getDefaultIndexer } from '../../modules/SilentPaymentIndexer';
import presentAlert from '../../components/Alert';
import { FOCUS_HANDOFF_MS } from '../../hooks/useRecoveryPhraseInput';
import loc from '../../loc';

jest.mock('../../hooks/context/useStorage');
jest.mock('../../hooks/context/useSettings');
jest.mock('../../hooks/useExtendedNavigation');
jest.mock('../../hooks/useScreenProtect', () => ({ useScreenProtect: jest.fn() }));
jest.mock('../../modules/SilentPaymentIndexer');
jest.mock('../../components/Alert');
jest.mock('../../modules/hapticFeedback');
// Hand-rolled and load-bearing: the official safe-area mock lacks initialMetrics (breaks SafeAreaScrollView's useSafeAreaInsets), and themes.ts's useTheme needs a real NavigationContainer — swapping either for a library default breaks rendering.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
}));
// Mutable so a test can open the screen the way the scanner returns to it, with onBarScanned set.
const mockRoute: { params: { onBarScanned?: string } } = { params: {} };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => mockRoute,
}));

const mockUseStorage = useStorage as jest.Mock;
const mockUseSettings = useSettings as jest.Mock;
const mockUseExtendedNavigation = useExtendedNavigation as jest.Mock;
const mockUseScreenProtect = jest.requireMock('../../hooks/useScreenProtect').useScreenProtect as jest.Mock;
const mockGetDefaultIndexer = getDefaultIndexer as jest.Mock;
const mockPresentAlert = presentAlert as jest.Mock;

const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const VALID_MNEMONIC_24 = `${'abandon '.repeat(23)}art`;

// The TextInput jest mock shares one focus() across instances; `this` says which pill it was called on.
const focusMock = TextInput.prototype.focus as unknown as jest.Mock;
const lastFocused = () => {
  const contexts = focusMock.mock.contexts as { props: { testID?: string } }[];
  return contexts[contexts.length - 1]?.props.testID;
};

const renderScreen = () =>
  render(
    <SafeAreaProvider>
      <NavigationContainer>
        <ImportWallet />
      </NavigationContainer>
    </SafeAreaProvider>,
  );

describe('unit - ImportWallet', () => {
  let addAndSaveWallet: jest.Mock;
  let navigateToWalletsList: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // __mocks__/react-native-image-picker (reached through the scan button) resets every mock before
    // each test, which strips keyboard-controller's mocks back to returning nothing.
    (KeyboardEvents.addListener as jest.Mock).mockImplementation(() => ({ remove: jest.fn() }));
    mockRoute.params = {};

    addAndSaveWallet = jest.fn().mockResolvedValue(undefined);
    navigateToWalletsList = jest.fn();

    mockUseStorage.mockReturnValue({ wallets: [], addAndSaveWallet });
    mockUseSettings.mockReturnValue({ isScreenCaptureAllowed: true, isClipboardGetContentEnabled: false });
    mockUseExtendedNavigation.mockReturnValue({
      navigateToWalletsList,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      getState: () => ({ index: 0 }),
      setParams: jest.fn((params: object) => Object.assign(mockRoute.params, params)),
      navigate: jest.fn(),
    });
    mockUseScreenProtect.mockReturnValue({ enableScreenProtect: jest.fn(), disableScreenProtect: jest.fn() });
    mockGetDefaultIndexer.mockReturnValue({ getLatestBlockHeight: jest.fn().mockResolvedValue({ height: 800000 }) });
  });

  // Pasting into the first pill spreads the words over the grid, the same as a user pasting there.
  const enterPhrase = (getByTestId: ReturnType<typeof renderScreen>['getByTestId'], phrase: string) =>
    fireEvent.changeText(getByTestId('MnemonicWordInput1'), phrase);

  const isRestoreDisabled = (getByTestId: ReturnType<typeof renderScreen>['getByTestId']) =>
    getByTestId('DoImport').props.accessibilityState?.disabled === true;

  describe('mnemonic validation', () => {
    it("keeps Restore off and names the problem when a word isn't on the wordlist", async () => {
      const { getByTestId } = renderScreen();

      enterPhrase(getByTestId, 'this is not a real seed phrase');

      assert.strictEqual(getByTestId('RecoveryPhraseNote').props.children, loc.wallets.restore_unknown_words);
      assert.strictEqual(isRestoreDisabled(getByTestId), true);
      fireEvent.press(getByTestId('DoImport'));
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.strictEqual(addAndSaveWallet.mock.calls.length, 0);
    });

    it("keeps Restore off when every word is real but the phrase doesn't check out", () => {
      const { getByTestId } = renderScreen();

      enterPhrase(getByTestId, VALID_MNEMONIC.replace('about', 'abandon'));

      assert.strictEqual(getByTestId('RecoveryPhraseNote').props.children, loc.wallets.restore_invalid_phrase);
      assert.strictEqual(isRestoreDisabled(getByTestId), true);
    });

    it('accepts a valid mnemonic, saves the wallet, and hands off after the success sheet is dismissed', async () => {
      const { getByTestId, queryByTestId } = renderScreen();

      enterPhrase(getByTestId, VALID_MNEMONIC);
      assert.strictEqual(queryByTestId('RecoveryPhraseNote'), null);
      assert.strictEqual(isRestoreDisabled(getByTestId), false);
      fireEvent.press(getByTestId('DoImport'));

      await waitFor(() => assert.strictEqual(addAndSaveWallet.mock.calls.length, 1));

      const [savedWallet] = addAndSaveWallet.mock.calls[0];
      assert.strictEqual(savedWallet.getSecret(), VALID_MNEMONIC);
      assert.strictEqual(savedWallet.getDerivationPath(), "m/86'/0'/0'");

      // Landing on the wallets list waits for the "You're all set" sheet's Done button.
      assert.strictEqual(navigateToWalletsList.mock.calls.length, 0);
      await waitFor(() => getByTestId('RestoreSuccessDoneButton'));
      fireEvent.press(getByTestId('RestoreSuccessDoneButton'));
      await waitFor(() => assert.strictEqual(navigateToWalletsList.mock.calls.length, 1));
      // The words don't stay on screen behind the sheet.
      assert.strictEqual(getByTestId('MnemonicWordInput1').props.value, '');
    });

    it('restores a 24-word phrase, switching the grid to 24 words', async () => {
      const { getByTestId } = renderScreen();

      enterPhrase(getByTestId, VALID_MNEMONIC_24);
      assert.strictEqual(getByTestId('MnemonicWordInput24').props.value, 'art');
      fireEvent.press(getByTestId('DoImport'));

      await waitFor(() => assert.strictEqual(addAndSaveWallet.mock.calls.length, 1));
      assert.strictEqual(addAndSaveWallet.mock.calls[0][0].getSecret(), VALID_MNEMONIC_24);
    });

    it('shows the save error and no success sheet when the wallet cannot be added', async () => {
      addAndSaveWallet.mockRejectedValue(new Error(loc.wallets.single_wallet_limit));
      const { getByTestId, queryByTestId } = renderScreen();

      enterPhrase(getByTestId, VALID_MNEMONIC);
      fireEvent.press(getByTestId('DoImport'));

      await waitFor(() =>
        assert.ok(
          mockPresentAlert.mock.calls.some(([arg]) => arg.message === loc.wallets.single_wallet_limit),
          'expected the limit alert',
        ),
      );
      assert.strictEqual(queryByTestId('RestoreSuccessSheet'), null);
    });
  });

  describe('word pills', () => {
    it('offers wordlist suggestions for the focused pill and fills it from one', () => {
      const { getByTestId, getByText } = renderScreen();
      const firstWord = getByTestId('MnemonicWordInput1');

      fireEvent(firstWord, 'focus');
      fireEvent.changeText(firstWord, 'abo');
      fireEvent.press(getByText('above'));

      assert.strictEqual(getByTestId('MnemonicWordInput1').props.value, 'above');
    });

    it('switches between 12 and 24 pills, keeping the words already typed', () => {
      const { getByTestId, getByText, queryByTestId } = renderScreen();
      assert.strictEqual(queryByTestId('MnemonicWordInput13'), null);

      fireEvent.changeText(getByTestId('MnemonicWordInput1'), 'zoo');
      fireEvent.press(getByText(loc.formatString(loc.wallets.restore_word_count, { count: 24 }) as string));

      assert.strictEqual(getByTestId('MnemonicWordInput24').props.value, '');
      assert.strictEqual(getByTestId('MnemonicWordInput1').props.value, 'zoo');
    });
  });

  describe('moving between pills', () => {
    it('moves to the next pill once a word is finished with a space', () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('MnemonicWordInput1'), 'aban ');
      assert.strictEqual(getByTestId('MnemonicWordInput1').props.value, 'abandon');
      assert.strictEqual(lastFocused(), 'MnemonicWordInput2');
    });

    it("stays put when the word isn't on the list", () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('MnemonicWordInput1'), 'poil ');
      assert.strictEqual(focusMock.mock.calls.length, 0);
    });

    it('moves on with the return key, and closes the keyboard after the last pill', () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      const { getByTestId } = renderScreen();
      fireEvent(getByTestId('MnemonicWordInput3'), 'submitEditing');
      assert.strictEqual(lastFocused(), 'MnemonicWordInput4');

      fireEvent(getByTestId('MnemonicWordInput12'), 'submitEditing');
      assert.strictEqual(dismiss.mock.calls.length, 1);
      dismiss.mockRestore();
    });

    it('steps back a pill on backspace in an empty one', () => {
      const { getByTestId } = renderScreen();
      fireEvent(getByTestId('MnemonicWordInput5'), 'keyPress', { nativeEvent: { key: 'Backspace' } });
      assert.strictEqual(lastFocused(), 'MnemonicWordInput4');
    });

    it('moves on after a suggestion is picked', () => {
      const { getByTestId, getByText } = renderScreen();
      fireEvent(getByTestId('MnemonicWordInput1'), 'focus');
      fireEvent.changeText(getByTestId('MnemonicWordInput1'), 'abo');
      fireEvent.press(getByText('about'));
      assert.strictEqual(lastFocused(), 'MnemonicWordInput2');
    });

    it('follows words pasted past the twelfth pill into the pills that appear for them', () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('MnemonicWordInput11'), 'abandon ability able ');
      assert.strictEqual(getByTestId('MnemonicWordInput13').props.value, 'able');
      assert.strictEqual(lastFocused(), 'MnemonicWordInput14');
    });
  });

  describe('suggestion bar', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('sits on the keyboard for a pill, and steps aside for the creation date without being told', () => {
      const { getByTestId } = renderScreen();
      const bar = () => getByTestId('WordSuggestionBar').props.enabled;
      assert.strictEqual(bar(), false);

      fireEvent(getByTestId('MnemonicWordInput1'), 'focus');
      assert.strictEqual(bar(), true);

      fireEvent(getByTestId('MnemonicWordInput1'), 'blur');
      fireEvent(getByTestId('BirthDateInput'), 'focus');
      act(() => jest.advanceTimersByTime(FOCUS_HANDOFF_MS));
      assert.strictEqual(bar(), false);
    });
  });

  describe('restore notes', () => {
    it('counts the words entered so far', () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('MnemonicWordInput1'), 'abandon abandon abandon');
      assert.strictEqual(
        getByTestId('RecoveryPhraseNote').props.children,
        loc.formatString(loc.wallets.restore_words_entered, { entered: 3, total: 12 }),
      );
    });

    it('points at a pill left empty in the middle', () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('MnemonicWordInput1'), VALID_MNEMONIC);
      fireEvent.changeText(getByTestId('MnemonicWordInput6'), '');
      assert.strictEqual(
        getByTestId('RecoveryPhraseNote').props.children,
        loc.formatString(loc.wallets.restore_missing_word, { number: 6 }),
      );
    });
  });

  describe('scanning', () => {
    it('restores a scanned phrase without a tap', async () => {
      mockRoute.params = { onBarScanned: VALID_MNEMONIC };
      const { getByTestId } = renderScreen();

      await waitFor(() => assert.strictEqual(addAndSaveWallet.mock.calls.length, 1));
      assert.strictEqual(addAndSaveWallet.mock.calls[0][0].getSecret(), VALID_MNEMONIC);
      await waitFor(() => getByTestId('RestoreSuccessDoneButton'));
    });

    it('puts a scanned code that is not a phrase in the pills instead of trying it', async () => {
      mockRoute.params = { onBarScanned: 'this is not a real seed phrase' };
      const { getByTestId } = renderScreen();

      assert.strictEqual(getByTestId('MnemonicWordInput2').props.value, 'is');
      assert.strictEqual(getByTestId('RecoveryPhraseNote').props.children, loc.wallets.restore_unknown_words);
      await new Promise(resolve => setTimeout(resolve, 700));
      assert.strictEqual(addAndSaveWallet.mock.calls.length, 0);
      assert.strictEqual(mockPresentAlert.mock.calls.length, 0);
    });
  });

  describe('passphrase', () => {
    it('restores with the passphrase and shows the wallet fingerprint', async () => {
      const { getByTestId } = renderScreen();

      enterPhrase(getByTestId, VALID_MNEMONIC);
      fireEvent(getByTestId('UsePassphraseToggle'), 'press');
      fireEvent.changeText(getByTestId('RestorePassphraseInput'), 'TREZOR');
      fireEvent.press(getByTestId('DoImport'));

      await waitFor(() => assert.strictEqual(addAndSaveWallet.mock.calls.length, 1));
      const [savedWallet] = addAndSaveWallet.mock.calls[0];
      assert.strictEqual(savedWallet.getPassphrase(), 'TREZOR');
      assert.ok(savedWallet.passphraseFingerprint);

      await waitFor(() => getByTestId('RestoreSuccessFingerprint'));
    });

    it('only fills in scanned words while a passphrase is switched on', async () => {
      jest.useFakeTimers();
      const { getByTestId, rerender } = renderScreen();
      fireEvent(getByTestId('UsePassphraseToggle'), 'press');
      // A complete passphrase, so a restore started by the scan would go through.
      fireEvent.changeText(getByTestId('RestorePassphraseInput'), 'TREZOR');

      mockRoute.params = { onBarScanned: VALID_MNEMONIC };
      rerender(
        <SafeAreaProvider>
          <NavigationContainer>
            <ImportWallet />
          </NavigationContainer>
        </SafeAreaProvider>,
      );
      act(() => jest.advanceTimersByTime(1000));
      jest.useRealTimers();

      await waitFor(() => assert.strictEqual(getByTestId('MnemonicWordInput12').props.value, 'about'));
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.strictEqual(addAndSaveWallet.mock.calls.length, 0);
    });

    it('does not restore while the passphrase is switched on but empty', () => {
      const { getByTestId } = renderScreen();

      enterPhrase(getByTestId, VALID_MNEMONIC);
      fireEvent(getByTestId('UsePassphraseToggle'), 'press');
      fireEvent.press(getByTestId('DoImport'));

      assert.strictEqual(addAndSaveWallet.mock.calls.length, 0);
    });
  });

  describe('paste button', () => {
    const mockClipboard = Clipboard as jest.Mocked<typeof Clipboard>;

    beforeEach(() => {
      mockUseSettings.mockReturnValue({ isScreenCaptureAllowed: true, isClipboardGetContentEnabled: true });
    });

    it('is hidden when clipboard reading is disabled', () => {
      mockUseSettings.mockReturnValue({ isScreenCaptureAllowed: true, isClipboardGetContentEnabled: false });
      const { queryByTestId } = renderScreen();
      assert.strictEqual(queryByTestId('PasteFromClipboardButton'), null);
    });

    it('fills the pills from the clipboard', async () => {
      mockClipboard.getImage = jest.fn().mockResolvedValue('');
      mockClipboard.getString.mockResolvedValue(VALID_MNEMONIC);
      const { getByTestId } = renderScreen();

      fireEvent.press(getByTestId('PasteFromClipboardButton'));

      await waitFor(() => assert.strictEqual(getByTestId('MnemonicWordInput12').props.value, 'about'));
      assert.strictEqual(getByTestId('MnemonicWordInput1').props.value, 'abandon');
    });
  });
});
