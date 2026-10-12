import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import loc, { formatBalanceWithoutSuffix } from '../../loc';
import { satoshiToLocalCurrency } from '../../modules/currency';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import ActionButton from '../../components/ActionButton';
import CheckBadgeIcon from '../../components/icons/CheckBadgeIcon';
import SegmentedProgressBar from '../../components/SegmentedProgressBar';
import FittedAmount from '../../components/FittedAmount';
import { ClashFont } from '../../constants/fonts';
import { splitForEmphasis } from '../../helpers/emphasis';

const CONFIRMATIONS_THRESHOLD = 6;
// Estimate for the "usually takes about N minutes" message, not a guarantee.
const AVERAGE_BLOCK_MINUTES = 10;

type PaymentFoundProps = NativeStackScreenProps<DetailViewStackParamList, 'PaymentFound'>;

const PaymentFound: React.FC<PaymentFoundProps> = ({ route }) => {
  const { txid, outputs, totalValue, confirmations } = route.params;
  const { wallets } = useStorage();
  const wallet = wallets.length > 0 ? (wallets[0] as HDSilentPaymentsWallet) : null;
  const navigation = useExtendedNavigation();
  const { colors } = useTheme();

  // Only needed for the "View Details" button; the amount/status above come from the scan result.
  const tx = useMemo(() => wallet?.getTransactions().find(t => t.txid === txid) ?? null, [wallet, txid]);

  const isConfirmed = confirmations >= CONFIRMATIONS_THRESHOLD;
  const confirmationsDisplay = Math.min(confirmations, CONFIRMATIONS_THRESHOLD);
  const remaining = CONFIRMATIONS_THRESHOLD - confirmationsDisplay;
  const estimatedMinutes = remaining * AVERAGE_BLOCK_MINUTES;

  const confirmingHighlight = loc.formatString(
    remaining === 1 ? loc.payment_found.confirming_highlight : loc.payment_found.confirming_highlight_plural,
    { count: String(remaining) },
  );
  const confirmingText = loc.formatString(loc.payment_found.confirming_text, {
    highlight: confirmingHighlight,
    minutes: String(estimatedMinutes),
  });
  const [confirmingBefore, confirmingMatch, confirmingAfter] = splitForEmphasis(confirmingText, confirmingHighlight);

  const formattedBTC = formatBalanceWithoutSuffix(totalValue, BitcoinUnit.BTC, true);
  const formattedFiat = satoshiToLocalCurrency(totalValue);

  // A self-send shows up here as a wallet-owned change output, not a payment from someone else.
  const isOwnChange = outputs.length > 0 && outputs.every(output => output.isChange);

  const handleViewDetails = () => {
    if (!tx) return;
    navigation.navigate('TransactionDetails', { tx, hash: txid, walletID: wallet?.getID() ?? '' });
  };

  // Resets the whole stack so this flow's screens don't sit underneath WalletsList.
  const handleDone = () => {
    navigation.navigateToWalletsList();
  };

  const stylesHook = StyleSheet.create({
    statusLabel: { color: colors.textBrand },
    amount: { color: colors.textPrimary },
    unit: { color: colors.textMuted },
    fiat: { color: colors.textMuted },
    changeNote: { color: colors.textMuted },
    confirmationsCard: { backgroundColor: colors.surfaceSubtle, borderColor: colors.accentSubtle },
    confirmationsLabel: { color: colors.textMuted },
    confirmationsCount: { color: colors.textBrand },
    messageBox: { backgroundColor: colors.background },
    messageHighlight: { color: colors.textPrimary },
    messageBody: { color: colors.textMuted },
    confirmedMessage: { color: colors.textPrimary },
  });

  return (
    <SafeArea>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <CheckBadgeIcon
              size={80}
              color={colors.brandPrimary}
              halo={{ background: colors.surfaceSubtle, border: colors.accentSubtle }}
            />
            <Text style={[styles.statusLabel, stylesHook.statusLabel]}>
              {isConfirmed ? loc.payment_found.confirmed : loc.payment_found.detected}
            </Text>
          </View>

          <View style={styles.amountGroup}>
            <View style={styles.amountRow}>
              <FittedAmount style={stylesHook.amount}>{formattedBTC}</FittedAmount>
              <Text style={[styles.unit, stylesHook.unit]}>{BitcoinUnit.BTC}</Text>
            </View>
            <Text style={[styles.fiat, stylesHook.fiat]}>≈ {formattedFiat}</Text>
            {isOwnChange && <Text style={[styles.changeNote, stylesHook.changeNote]}>{loc.payment_found.change_note}</Text>}
          </View>

          <View style={[styles.confirmationsCard, stylesHook.confirmationsCard]}>
            <View style={styles.confirmationsHeader}>
              <Text style={[styles.confirmationsLabel, stylesHook.confirmationsLabel]}>{loc.payment_found.confirmations_header}</Text>
              <Text style={[styles.confirmationsCount, stylesHook.confirmationsCount]}>
                {loc.formatString(loc.payment_found.confirmations_count, { current: confirmationsDisplay, total: CONFIRMATIONS_THRESHOLD })}
              </Text>
            </View>

            <SegmentedProgressBar
              segments={CONFIRMATIONS_THRESHOLD}
              filled={confirmationsDisplay}
              filledColor={isConfirmed ? colors.statusSuccess : colors.brandPrimary}
              trackColor={colors.borderDefault}
            />

            <View style={[styles.messageBox, stylesHook.messageBox]}>
              {isConfirmed ? (
                <View style={styles.confirmedMessageRow}>
                  <CheckBadgeIcon size={20} color={colors.brandPrimary} />
                  <Text style={[styles.confirmedMessage, stylesHook.confirmedMessage]}>{loc.payment_found.confirmed_message}</Text>
                </View>
              ) : (
                <Text style={styles.messageText}>
                  {confirmingBefore}
                  <Text style={[styles.messageHighlight, stylesHook.messageHighlight]}>{confirmingMatch}</Text>
                  <Text style={stylesHook.messageBody}>{confirmingAfter}</Text>
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <ActionButton
            title={loc.payment_found.view_details}
            onPress={handleViewDetails}
            backgroundColor={colors.background}
            color={colors.textPrimary}
            borderColor={colors.borderDefault}
            testID="ViewDetailsButton"
          />
          <ActionButton
            title={loc.payment_found.done}
            onPress={handleDone}
            backgroundColor={colors.brandPrimary}
            color={colors.white}
            testID="DoneButton"
          />
        </View>
      </ScrollView>
    </SafeArea>
  );
};

export default PaymentFound;

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    justifyContent: 'space-between',
  },
  content: {
    alignItems: 'center',
    gap: 24,
  },
  hero: {
    alignItems: 'center',
    gap: 12,
  },
  statusLabel: {
    fontFamily: ClashFont.medium,
    fontSize: 16,
    lineHeight: 24,
  },
  amountGroup: {
    alignItems: 'center',
    gap: 4,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  unit: {
    fontFamily: ClashFont.regular,
    fontSize: 22,
    marginLeft: 10,
  },
  fiat: {
    fontFamily: ClashFont.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  changeNote: {
    fontFamily: ClashFont.regular,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
  confirmationsCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  confirmationsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confirmationsLabel: {
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmationsCount: {
    fontFamily: ClashFont.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  messageBox: {
    borderRadius: 12,
    padding: 12,
  },
  messageText: {
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  messageHighlight: {
    fontFamily: ClashFont.medium,
  },
  confirmedMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmedMessage: {
    flex: 1,
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  buttonContainer: {
    paddingTop: 20,
    paddingBottom: 24,
    gap: 12,
  },
});
