import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RouteProp, useRoute } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import { ActivityIndicator, Keyboard, Platform, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActionButton from '../../components/ActionButton';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useKeyboard } from '../../hooks/useKeyboard';
import loc from '../../loc';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AddressInputScanButton } from '../../components/AddressInputScanButton';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import SafeAreaScrollView, { KEYBOARD_BOTTOM_OFFSET } from '../../components/SafeAreaScrollView';
import InfoBanner from '../../components/InfoBanner';
import PillSegmentedControl from '../../components/PillSegmentedControl';
import RecoveryPhraseGrid from '../../components/RecoveryPhraseGrid';
import WordSuggestionBar, { WORD_SUGGESTION_BAR_HEIGHT } from '../../components/WordSuggestionBar';
import { useRecoveryPhraseInput } from '../../hooks/useRecoveryPhraseInput';
import { GRID_SIZES, PhraseNote } from '../../helpers/recoveryPhrase';
import ClipboardIcon from '../../components/icons/ClipboardIcon';
import RestoreSuccessSheet from '../../components/RestoreSuccessSheet';
import { BottomModalHandle } from '../../components/BottomModal';
import { ClashFont } from '../../constants/fonts';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet.ts';
import { useStorage } from '../../hooks/context/useStorage';
import presentAlert from '../../components/Alert';
import { WalletBirthSection } from '../../components/WalletBirthSection';
import { clampBirthHeight } from '../../modules/constants';
import { getActiveNetwork } from '../../modules/network';
import { getDefaultIndexer } from '../../modules/SilentPaymentIndexer';
import { readClipboardForPaste } from '../../helpers/clipboard';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';

type RouteProps = RouteProp<AddWalletStackParamList, 'ImportWallet'>;
type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'ImportWallet'>;

type BirthHeightResult =
  | { ok: true; height: number; pendingTimestamp: number | null }
  | { ok: false; error: 'invalid_date' | 'future_date' };

async function resolveBirthHeight(dateStr: string): Promise<BirthHeightResult> {
  // The wallet being imported is created on the selected chain, so its floor is that chain's.
  const floor = getActiveNetwork().bip352ActivationHeight;
  const trimmed = dateStr.trim();
  if (trimmed.length === 0) {
    return { ok: true, height: floor, pendingTimestamp: null };
  }

  // Append T00:00:00 to treat YYYY-MM-DD as local time, not UTC
  const normalised = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00` : trimmed;
  const parsedTimestamp = Date.parse(normalised);

  if (Number.isNaN(parsedTimestamp)) {
    return { ok: false, error: 'invalid_date' };
  }

  const inputDate = new Date(parsedTimestamp);
  if (inputDate > new Date()) {
    return { ok: false, error: 'future_date' };
  }

  const timestampSeconds = Math.floor(inputDate.getTime() / 1000);

  try {
    const indexer = getDefaultIndexer();
    const [tip, byTimestamp] = await Promise.all([indexer.getLatestBlockHeight(), indexer.getBlockHeightByTimestamp(timestampSeconds)]);
    const height = clampBirthHeight(byTimestamp.blockHeight, tip.height, floor);
    return { ok: true, height, pendingTimestamp: null };
  } catch (error) {
    console.warn('[SP] Birth height lookup failed, deferring resolution to the first scan:', error);
    return { ok: true, height: floor, pendingTimestamp: timestampSeconds };
  }
}

const noteText = (note: PhraseNote): string => {
  switch (note.kind) {
    case 'unknown_words':
      return loc.wallets.restore_unknown_words;
    case 'invalid_phrase':
      return loc.wallets.restore_invalid_phrase;
    case 'missing_word':
      return loc.formatString(loc.wallets.restore_missing_word, { number: note.number }) as string;
    case 'progress':
      return loc.formatString(loc.wallets.restore_words_entered, { entered: note.entered, total: note.total }) as string;
  }
};

const ImportWallet = () => {
  const navigation = useExtendedNavigation<NavigationProps>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProps>();
  const phraseInput = useRecoveryPhraseInput();
  const { fillFromText, clear: clearPhrase } = phraseInput;
  const [birthDate, setBirthDate] = useState<string>('');
  const [isToolbarVisibleForAndroid, setIsToolbarVisibleForAndroid] = useState<boolean>(false);
  const [, setSpeedBackdoor] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { isScreenCaptureAllowed, isClipboardGetContentEnabled } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();
  const { addAndSaveWallet } = useStorage();
  const successSheetRef = useRef<BottomModalHandle>(null);

  useKeyboard({
    onKeyboardDidShow: () => {
      setIsToolbarVisibleForAndroid(true);
    },
    onKeyboardDidHide: () => {
      setIsToolbarVisibleForAndroid(false);
    },
  });

  // Takes a phrase the recovery-phrase input has already checked against the wordlists and checksum.
  const restoreWallet = useCallback(
    async (phrase: string) => {
      try {
        if (await Clipboard.hasString()) {
          Clipboard.setString('');
        }
      } catch (error) {
        console.error('Failed to clear clipboard:', error);
      }

      Keyboard.dismiss();
      setIsLoading(true);

      let restored = false;
      try {
        const wallet = HDSilentPaymentsWallet.fromMnemonic(phrase);

        const birthHeightResult = await resolveBirthHeight(birthDate);
        if (!birthHeightResult.ok) {
          const messages: Record<Extract<BirthHeightResult, { ok: false }>['error'], string> = {
            invalid_date: loc.wallet_birth.error_invalid_date,
            future_date: loc.wallet_birth.error_future_date,
          };
          presentAlert({ title: loc.errors.error, message: messages[birthHeightResult.error] });
          return;
        }

        wallet.updateBirthHeight(birthHeightResult.height, {
          resetScan: true,
          pendingTimestamp: birthHeightResult.pendingTimestamp,
        });

        await addAndSaveWallet(wallet);
        restored = true;
      } catch (error: any) {
        console.error('Import error:', error);
        presentAlert({
          title: loc.wallets.restore_error,
          message: error.message || loc.wallet_birth.error_import_failed,
          hapticFeedback: HapticFeedbackTypes.NotificationError,
        });
      } finally {
        setIsLoading(false);
      }

      // Outside the try: the wallet is saved by now, so a sheet failure must not read as a failed restore.
      if (restored) {
        clearPhrase();
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        await successSheetRef.current?.present();
      }
    },
    [birthDate, addAndSaveWallet, clearPhrase],
  );

  const handleImport = useCallback(() => {
    if (phraseInput.phrase) restoreWallet(phraseInput.phrase);
  }, [restoreWallet, phraseInput.phrase]);

  const onBarScanned = useCallback(
    (value: string | { data: any }) => {
      // no objects here, only strings
      const newValue: string = typeof value !== 'string' ? value.data + '' : value;
      // A scanned phrase restores straight away. Anything else stays in the pills, where the
      // words that are wrong show up in red.
      const phrase = fillFromText(newValue);
      if (phrase) setTimeout(() => restoreWallet(phrase), 500);
    },
    [fillFromText, restoreWallet],
  );

  useEffect(() => {
    const data = route.params?.onBarScanned;
    if (data) {
      onBarScanned(data);
      navigation.setParams({ onBarScanned: undefined });
    }
  }, [route.name, onBarScanned, route.params?.onBarScanned, navigation]);

  const speedBackdoorTap = () => {
    setSpeedBackdoor(v => {
      v += 1;
      if (v < 5) return v;
      navigation.navigate('ImportSpeed');
      return 0;
    });
  };

  useEffect(() => {
    if (!isScreenCaptureAllowed) {
      enableScreenProtect();
    }
    return () => {
      disableScreenProtect();
    };
  }, [isScreenCaptureAllowed, enableScreenProtect, disableScreenProtect]);

  const onPasteFromClipboard = useCallback(async () => {
    try {
      fillFromText(await readClipboardForPaste());
    } catch (error) {
      presentAlert({ message: (error as Error).message });
    }
  }, [fillFromText]);

  const onDoneFromSuccessSheet = useCallback(async () => {
    await successSheetRef.current?.dismiss();
    navigation.navigateToWalletsList();
  }, [navigation]);

  const canImport = phraseInput.phrase !== null && !isLoading;
  const note = phraseInput.note;
  const isProblem = note?.kind === 'unknown_words' || note?.kind === 'invalid_phrase';

  const footer = (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
      <ActionButton
        title={loc.wallets.restore_cta}
        onPress={handleImport}
        disabled={!canImport}
        backgroundColor={colors.brandPrimary}
        color={colors.white}
        testID="DoImport"
      />
      <AddressInputScanButton onChangeText={fillFromText} testID="ScanImport" />
    </View>
  );

  return (
    <View style={styles.root}>
      <SafeAreaScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
        // Keeps the word being typed clear of the suggestion bar as well as the keyboard.
        bottomOffset={KEYBOARD_BOTTOM_OFFSET + WORD_SUGGESTION_BAR_HEIGHT}
        testID="ImportWalletScrollView"
      >
        <View style={styles.body}>
          <TouchableWithoutFeedback accessibilityRole="button" onPress={speedBackdoorTap} testID="SpeedBackdoor">
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.wallets.restore_headline}</Text>
              <Text style={[styles.subtitle, { color: colors.textMuted }]}>{loc.wallets.restore_subtitle}</Text>
            </View>
          </TouchableWithoutFeedback>

          <PillSegmentedControl
            segments={GRID_SIZES.map(count => ({ label: loc.formatString(loc.wallets.restore_word_count, { count }) as string }))}
            selectedIndex={GRID_SIZES.indexOf(phraseInput.wordCount)}
            onChange={index => phraseInput.setWordCount(GRID_SIZES[index])}
          />

          <View style={styles.phrase}>
            <RecoveryPhraseGrid
              words={phraseInput.words}
              statuses={phraseInput.statuses}
              focusedIndex={phraseInput.focusedIndex}
              handlers={phraseInput.handlers}
            />
            {note && (
              <Text
                style={[styles.note, { color: isProblem ? colors.statusError : colors.textMuted }]}
                // Problems are announced; the running word count isn't, it changes with every word.
                accessibilityLiveRegion={isProblem ? 'polite' : 'none'}
                testID="RecoveryPhraseNote"
              >
                {noteText(note)}
              </Text>
            )}
          </View>

          {isClipboardGetContentEnabled && (
            <ActionButton
              title={loc.wallets.restore_paste_button}
              Icon={ClipboardIcon}
              iconSize={20}
              onPress={onPasteFromClipboard}
              backgroundColor={colors.fieldBackground}
              color={colors.textPrimary}
              testID="PasteFromClipboardButton"
            />
          )}

          <WalletBirthSection birthDate={birthDate} setBirthDate={setBirthDate} />

          <InfoBanner text={loc.wallets.restore_history_notice} emphasis={loc.wallets.restore_history_notice_emphasis} />

          {isLoading && <ActivityIndicator size="large" color={colors.brandPrimary} style={styles.activityIndicator} />}
        </View>

        <View style={styles.spacer} />

        {Platform.select({ android: !isToolbarVisibleForAndroid && footer, default: footer })}

        <RestoreSuccessSheet ref={successSheetRef} onDone={onDoneFromSuccessSheet} />
      </SafeAreaScrollView>

      <WordSuggestionBar
        enabled={phraseInput.ownsKeyboard}
        typed={phraseInput.activeWord}
        suggestions={phraseInput.suggestions}
        onPick={phraseInput.acceptSuggestion}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 0 },
  body: { gap: 20 },
  header: { marginBottom: 4 },
  title: { fontFamily: ClashFont.medium, fontSize: 32, letterSpacing: -1, marginBottom: 8 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 20 },
  phrase: { gap: 12 },
  note: { fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 20 },
  spacer: { flex: 1 },
  footer: { paddingTop: 16, gap: 12 },
  activityIndicator: { marginTop: 4 },
});

export default ImportWallet;
