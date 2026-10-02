import React, { useCallback, useState } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { RouteProp, usePreventRemove, useRoute } from '@react-navigation/native';
import dayjs from 'dayjs';
import { Pressable, StyleSheet, TextInput, View, Text, Linking } from 'react-native';
import { useTheme } from '../../components/themes';
import loc, { formatBalanceWithoutSuffix } from '../../loc';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { useStorage } from '../../hooks/context/useStorage';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import TransactionDirectionIcon from '../../components/icons/TransactionDirectionIcon';
import { getTransactionIconColors } from '../../components/icons/getTransactionIconColors';
import { isIncomingTransaction, getRelevantAddress } from '../../utils/transactionHelpers';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { ClashFont } from '../../constants/fonts';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import ExternalLinkIcon from '../../components/icons/ExternalLinkIcon';
import { getActiveNetwork } from '../../modules/network';
import DetailRow from '../../components/DetailRow';

type RouteProps = RouteProp<DetailViewStackParamList, 'TransactionDetails'>;

const TransactionDetails = () => {
  const { tx, hash, walletID } = useRoute<RouteProps>().params;
  const { saveToDisk, txMetadata, wallets } = useStorage();
  const [memo, setMemo] = useState<string>(txMetadata[hash]?.memo ?? '');
  const { colors } = useTheme();
  const wallet = wallets.find(w => w.getID() === walletID);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedTxid, setCopiedTxid] = useState(false);

  const saveTransactionDetails = useCallback(() => {
    txMetadata[hash] = { memo };
    saveToDisk();
  }, [hash, txMetadata, memo, saveToDisk]);

  usePreventRemove(false, () => {
    saveTransactionDetails();
  });

  const handleMemoBlur = useCallback(() => {
    saveTransactionDetails();
  }, [saveTransactionDetails]);

  const handleCopy = (text: string, setFlag: (b: boolean) => void) => {
    Clipboard.setString(text);
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
    setFlag(true);
    setTimeout(() => setFlag(false), 1000);
  };

  const viewInBlockExplorer = () => {
    if (tx?.hash) {
      Linking.openURL(getActiveNetwork().explorerTxUrl(tx.hash));
    }
  };

  const isIncoming = isIncomingTransaction(tx.value);
  const amount = formatBalanceWithoutSuffix(tx.value ?? 0, BitcoinUnit.BTC, true);
  const address = getRelevantAddress(tx, wallet);
  const confirmations = tx.confirmations;

  // TODO: Add actual split transaction check logic when available in the wallet
  const isSplit = false;

  const stylesHooks = StyleSheet.create({
    headerStatus: { color: colors.textBrand },
    amountValue: { color: colors.textSecondary },
    amountUnit: { color: colors.textMuted },
    dateText: { color: colors.iconSecondary },
    noteLabel: { color: colors.textMuted },
    memoTextInput: {
      backgroundColor: colors.fieldBackground,
      color: colors.textSecondary,
    },
    divider: { backgroundColor: colors.borderDefault },
    summaryTitle: { color: colors.textSecondary },
    summaryTitleSecondary: { color: colors.textMuted },
    summaryValueConfirmations: { color: colors.textBrand },
    explorerButton: {
      backgroundColor: colors.background,
      borderColor: colors.borderDefault,
    },
    splitTag: {
      backgroundColor: colors.surfaceSubtle,
    },
  });

  return (
    <SafeAreaScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        {/* Header: Icon + Status + Amount + Date */}
        <View style={styles.headerContainer}>
          <TransactionDirectionIcon size={44} {...getTransactionIconColors(colors, tx.value)} />
          <View style={styles.statusContainer}>
            <Text style={[styles.headerStatus, stylesHooks.headerStatus]}>{isIncoming ? 'RECEIVED' : 'SENT'}</Text>
            {isSplit && (
              <View style={[styles.splitTag, stylesHooks.splitTag]}>
                <Text style={[styles.splitTagText, { color: colors.textBrand }]}>SPLIT</Text>
              </View>
            )}
          </View>
          <View style={styles.amountContainer}>
            <Text style={[styles.amountValue, stylesHooks.amountValue]}>{amount}</Text>
            <Text style={[styles.amountUnit, stylesHooks.amountUnit]}>BTC</Text>
          </View>
          <Text style={[styles.dateText, stylesHooks.dateText]}>{dayjs(tx.timestamp * 1000).format('MMMM D, YYYY [·] h:mm A')}</Text>
        </View>

        {/* Note Section */}
        <View style={styles.noteContainer}>
          <Text style={[styles.noteLabel, stylesHooks.noteLabel]}>Note</Text>
          <TextInput
            placeholder="Only visible to you"
            value={memo}
            placeholderTextColor={colors.textMuted}
            clearButtonMode="while-editing"
            style={[styles.memoTextInput, stylesHooks.memoTextInput]}
            onChangeText={setMemo}
            onBlur={handleMemoBlur}
            testID="TransactionDetailsMemoInput"
          />
        </View>

        {/* Info Rows: Address + Transaction ID */}
        <View style={styles.infoSection}>
          <DetailRow
            label={isIncoming ? 'Received at' : 'Sent to'}
            value={address || 'Unknown'}
            mono
            copied={copiedAddr}
            onCopy={address ? () => handleCopy(address, setCopiedAddr) : undefined}
            accessibilityLabel={loc.transactions.details_copy}
          />

          <View style={[styles.divider, stylesHooks.divider]} />

          <DetailRow
            label="Transaction ID"
            value={tx.hash}
            mono
            copied={copiedTxid}
            onCopy={() => handleCopy(tx.hash, setCopiedTxid)}
            accessibilityLabel={loc.transactions.details_copy_txid}
          />
        </View>

        <View style={[styles.divider, stylesHooks.divider]} />

        {/* Summary: Confirmations, Outputs, Fee */}
        <View style={styles.summarySection}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryTitle, stylesHooks.summaryTitle]}>Confirmations</Text>
            <Text style={[styles.summaryValue, stylesHooks.summaryValueConfirmations]}>{confirmations > 6 ? '6+' : confirmations}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryTitle, stylesHooks.summaryTitle]}>Outputs</Text>
            <Text style={[styles.summaryTitleLight, stylesHooks.summaryTitleSecondary]}>{tx.outputs?.length || 0}</Text>
          </View>
          {/* TODO: plugin actual fee value (we don't store the fee rn, in txn) */}
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryTitle, stylesHooks.summaryTitle]}>Fee</Text>
            <Text style={[styles.summaryTitleLight, stylesHooks.summaryTitleSecondary]}>-</Text>
          </View>
        </View>

        {/* Block Explorer Button */}
        <View style={styles.actionContainer}>
          <Pressable accessibilityRole="button" style={[styles.explorerButton, stylesHooks.explorerButton]} onPress={viewInBlockExplorer}>
            <ExternalLinkIcon size={24} color={colors.textSecondary} />
            <Text style={[styles.explorerButtonText, { color: colors.textSecondary }]}>View In Block Explorer</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: 'center',
    paddingBottom: 24,
    flex: 1,
  },
  headerContainer: {
    alignItems: 'center',
    gap: 4,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerStatus: {
    fontFamily: ClashFont.medium,
    fontSize: 14,
    lineHeight: 24,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  splitTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  splitTagText: {
    fontFamily: ClashFont.semibold,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },
  amountValue: {
    fontFamily: ClashFont.medium,
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: -1.2,
    textAlign: 'center',
  },
  amountUnit: {
    fontFamily: ClashFont.regular,
    fontSize: 15,
    lineHeight: 18,
    marginBottom: 5,
    textAlign: 'center',
  },
  dateText: {
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  noteContainer: {
    width: '100%',
    marginTop: 14,
    gap: 8,
  },
  noteLabel: {
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  memoTextInput: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    fontFamily: ClashFont.regular,
    fontSize: 13,
    lineHeight: 20,
    minHeight: 48,
  },
  infoSection: {
    width: '100%',
    marginTop: 14,
  },
  divider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  summarySection: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  summaryItem: {
    alignItems: 'flex-start',
    gap: 8,
  },
  summaryTitle: {
    fontFamily: ClashFont.medium,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  summaryTitleLight: {
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  summaryValue: {
    fontFamily: ClashFont.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  actionContainer: {
    width: '100%',
    marginTop: 'auto',
  },
  explorerButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    height: 56,
    gap: 9,
  },
  explorerButtonText: {
    fontFamily: ClashFont.medium,
    fontSize: 16,
  },
});

export default TransactionDetails;
