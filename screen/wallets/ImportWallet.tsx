import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RouteProp, useRoute } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import { ActivityIndicator, Keyboard, Platform, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActionButton from '../../components/ActionButton';
import {
  DoneAndDismissKeyboardInputAccessory,
  DoneAndDismissKeyboardInputAccessoryViewID,
} from '../../components/DoneAndDismissKeyboardInputAccessory';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useKeyboard } from '../../hooks/useKeyboard';
import loc from '../../loc';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AddressInputScanButton } from '../../components/AddressInputScanButton';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { FieldMnemonicInput } from '../../components/FieldTextInput';
import LabeledField from '../../components/LabeledField';
import InfoBanner from '../../components/InfoBanner';
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

const ImportWallet = () => {
  const navigation = useExtendedNavigation<NavigationProps>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProps>();
  const label = route?.params?.label ?? '';
  const triggerImport = route?.params?.triggerImport ?? false;
  const [importText, setImportText] = useState<string>(label);
  const [birthDate, setBirthDate] = useState<string>('');
  const [isToolbarVisibleForAndroid, setIsToolbarVisibleForAndroid] = useState<boolean>(false);
  const [, setSpeedBackdoor] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { isScreenCaptureAllowed, isClipboardGetContentEnabled } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();
  const { addAndSaveWallet } = useStorage();
  const successSheetRef = useRef<BottomModalHandle>(null);

  const onBlur = useCallback(() => {
    const valueWithSingleWhitespace = importText.replace(/^\s+|\s+$|\s+(?=\s)/g, '');
    setImportText(valueWithSingleWhitespace);
    return valueWithSingleWhitespace;
  }, [importText]);

  useKeyboard({
    onKeyboardDidShow: () => {
      setIsToolbarVisibleForAndroid(true);
    },
    onKeyboardDidHide: () => {
      setIsToolbarVisibleForAndroid(false);
    },
  });

  const importMnemonic = useCallback(
    async (text: string) => {
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
        if (!text.trim()) {
          presentAlert({ title: loc.errors.error, message: loc.wallet_birth.error_empty_mnemonic });
          return;
        }

        const wallet = HDSilentPaymentsWallet.fromMnemonic(text);

        if (!wallet.validateMnemonic()) {
          presentAlert({ title: loc.errors.error, message: loc.wallet_birth.error_invalid_mnemonic });
          return;
        }

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
        setImportText('');
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        await successSheetRef.current?.present();
      }
    },
    [birthDate, addAndSaveWallet],
  );

  const handleImport = useCallback(() => {
    const textToImport = onBlur();
    if (textToImport.trim().length === 0) {
      return;
    }
    importMnemonic(textToImport);
  }, [importMnemonic, onBlur]);

  const onBarScanned = useCallback(
    (value: string | { data: any }) => {
      // no objects here, only strings
      const newValue: string = typeof value !== 'string' ? value.data + '' : value;
      setImportText(newValue);
      setTimeout(() => importMnemonic(newValue), 500);
    },
    [importMnemonic],
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

  useEffect(() => {
    if (triggerImport) handleImport();
  }, [triggerImport, handleImport]);

  const onPasteFromClipboard = useCallback(async () => {
    try {
      setImportText(await readClipboardForPaste());
    } catch (error) {
      presentAlert({ message: (error as Error).message });
    }
  }, []);

  const onDoneFromSuccessSheet = useCallback(async () => {
    await successSheetRef.current?.dismiss();
    navigation.navigateToWalletsList();
  }, [navigation]);

  const canImport = importText.trim().length > 0 && !isLoading;

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
      <AddressInputScanButton onChangeText={setImportText} testID="ScanImport" />
    </View>
  );

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="always" automaticallyAdjustKeyboardInsets>
      <View style={styles.body}>
        <TouchableWithoutFeedback accessibilityRole="button" onPress={speedBackdoorTap} testID="SpeedBackdoor">
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.wallets.restore_headline}</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>{loc.wallets.restore_subtitle}</Text>
          </View>
        </TouchableWithoutFeedback>

        <LabeledField>
          <FieldMnemonicInput
            value={importText}
            onBlur={onBlur}
            onChangeText={setImportText}
            placeholder={loc.wallets.restore_mnemonic_placeholder}
            accessibilityLabel={loc.wallets.restore_mnemonic_label}
            testID="MnemonicInput"
            inputAccessoryViewID={DoneAndDismissKeyboardInputAccessoryViewID}
            style={styles.mnemonicInput}
          />
        </LabeledField>

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
      {Platform.select({
        ios: (
          <DoneAndDismissKeyboardInputAccessory
            onClearTapped={() => {
              setImportText('');
            }}
            onPasteTapped={
              isClipboardGetContentEnabled
                ? text => {
                    setImportText(text);
                    Keyboard.dismiss();
                  }
                : undefined
            }
          />
        ),
        default: null,
      })}

      <RestoreSuccessSheet ref={successSheetRef} onDone={onDoneFromSuccessSheet} />
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 0 },
  body: { gap: 20 },
  header: { marginBottom: 4 },
  title: { fontFamily: ClashFont.medium, fontSize: 32, letterSpacing: -1, marginBottom: 8 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 20 },
  mnemonicInput: { minHeight: 72, textAlignVertical: 'top' },
  spacer: { flex: 1 },
  footer: { paddingTop: 16, gap: 12 },
  activityIndicator: { marginTop: 4 },
});

export default ImportWallet;
