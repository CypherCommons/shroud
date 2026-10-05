import React, { useEffect, useMemo, useReducer } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@rneui/themed';
import BigNumber from 'bignumber.js';
import * as bitcoin from 'bitcoinjs-lib';
import Clipboard from '@react-native-clipboard/clipboard';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import loc, { formatBalanceWithoutSuffix } from '../../loc';
import { useRoute, RouteProp } from '@react-navigation/native';
import presentAlert from '../../components/Alert';
import { useTheme } from '../../components/themes';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import SafeArea from '../../components/SafeArea';
import TestnetBadge from '../../components/TestnetBadge';
import { satoshiToBTC, satoshiToLocalCurrency } from '../../modules/currency';
import * as Electrum from '../../modules/Electrum';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import { TWallet } from '../../class/wallets/types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useStorage } from '../../hooks/context/useStorage';
import AmountHero from '../../components/AmountHero';
import DetailRow from '../../components/DetailRow';
import SendIcon from '../../components/icons/SendIcon';
import { ClashFont } from '../../constants/fonts';
import { computeTotalSats } from '../../helpers/send/format';

enum ActionType {
  SET_LOADING = 'SET_LOADING',
  SET_BUTTON_DISABLED = 'SET_BUTTON_DISABLED',
}

type Action = { type: ActionType.SET_LOADING; payload: boolean } | { type: ActionType.SET_BUTTON_DISABLED; payload: boolean };

interface State {
  isLoading: boolean;
  isButtonDisabled: boolean;
}

const initialState: State = {
  isLoading: false,
  isButtonDisabled: false,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case ActionType.SET_LOADING:
      return { ...state, isLoading: action.payload };
    case ActionType.SET_BUTTON_DISABLED:
      return { ...state, isButtonDisabled: action.payload };
    default:
      return state;
  }
};

type ConfirmRouteProp = RouteProp<SendDetailsStackParamList, 'Confirm'>;
type ConfirmNavigationProp = NativeStackNavigationProp<SendDetailsStackParamList, 'Confirm'>;

const Confirm: React.FC = () => {
  const { wallets, fetchAndSaveWalletTransactions } = useStorage();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const navigation = useExtendedNavigation<ConfirmNavigationProp>();
  const route = useRoute<ConfirmRouteProp>();
  const { recipients, walletID, fee, tx, recipientAddress } = route.params;

  const [state, dispatch] = useReducer(reducer, initialState);
  const { navigate, goBack } = navigation;
  const wallet = wallets.find((w: TWallet) => w.getID() === walletID) as TWallet;
  const feeSatoshi = new BigNumber(fee).multipliedBy(100000000).toNumber();
  const { colors } = useTheme();
  const [copiedAddr, setCopiedAddr] = React.useState(false);
  const [copiedTxid, setCopiedTxid] = React.useState(false);

  const stylesHook = StyleSheet.create({
    root: { backgroundColor: colors.background },
    divider: { backgroundColor: colors.borderDefault },
    summaryLabel: { color: colors.textMuted },
    summaryValue: { color: colors.textPrimary },
    summaryFiat: { color: colors.textMuted },
    totalLabel: { color: colors.textSecondary },
    totalValue: { color: colors.textBrand },
    sendNowButton: { backgroundColor: colors.brandPrimary },
    sendNowButtonDisabled: { backgroundColor: colors.ctaDisabled },
    sendNowText: { color: colors.white },
  });

  useEffect(() => {
    if (!wallet) {
      goBack();
    }
  }, [wallet, goBack]);

  const handleSendTransaction = async () => {
    dispatch({ type: ActionType.SET_BUTTON_DISABLED, payload: true });
    dispatch({ type: ActionType.SET_LOADING, payload: true });
    try {
      if (await isBiometricUseCapableAndEnabled()) {
        if (!(await unlockWithBiometrics())) {
          dispatch({ type: ActionType.SET_LOADING, payload: false });
          dispatch({ type: ActionType.SET_BUTTON_DISABLED, payload: false });
          return;
        }
      }

      const txidsToWatch = [];
      const result = await broadcastTransaction(tx);
      if (!result) {
        dispatch({ type: ActionType.SET_LOADING, payload: false });
        dispatch({ type: ActionType.SET_BUTTON_DISABLED, payload: false });
        return;
      }

      const txid = bitcoin.Transaction.fromHex(tx).getId();
      txidsToWatch.push(txid);
      let amount = 0;
      for (const recipient of recipients) {
        if (recipient.value) {
          amount += recipient.value;
        }
      }

      amount = Number(formatBalanceWithoutSuffix(amount, BitcoinUnit.BTC, false));
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      navigate('Success', {
        fee: Number(fee),
        amount,
        txid,
        recipientAddress,
      });

      dispatch({ type: ActionType.SET_LOADING, payload: false });

      await new Promise(resolve => setTimeout(resolve, 3000)); // sleep to make sure network propagates
      fetchAndSaveWalletTransactions(walletID);
    } catch (error: any) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      dispatch({ type: ActionType.SET_LOADING, payload: false });
      dispatch({ type: ActionType.SET_BUTTON_DISABLED, payload: false });
      presentAlert({ message: error.message });
    }
  };

  const broadcastTransaction = async (transaction: string) => {
    await Electrum.ping();
    await Electrum.waitTillConnected();

    const result = await wallet.broadcastTx(transaction);
    if (!result) {
      throw new Error(loc.errors.broadcast);
    }

    return result;
  };

  const recipient = recipients[0];
  const amountSats = recipient?.value ?? 0;
  const txid = useMemo(() => {
    try {
      return tx ? bitcoin.Transaction.fromHex(tx).getId() : '';
    } catch {
      return '';
    }
  }, [tx]);
  const totalSats = computeTotalSats(amountSats, feeSatoshi);
  const copy = (text: string, setFlag: (b: boolean) => void) => {
    Clipboard.setString(text);
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
    setFlag(true);
    setTimeout(() => setFlag(false), 1000);
  };

  return (
    <SafeArea style={[styles.root, stylesHook.root]}>
      <View style={styles.content}>
        <TestnetBadge style={styles.testnetBadge} />
        <AmountHero amount={satoshiToBTC(amountSats)} fiat={`≈ ${satoshiToLocalCurrency(amountSats)}`} />

        <View style={[styles.divider, stylesHook.divider]} />

        <View style={styles.detailsGroup}>
          <View>
            <DetailRow
              label={loc.send.onchain_address_derived}
              value={recipient?.address ?? ''}
              mono
              copied={copiedAddr}
              onCopy={() => copy(recipient?.address ?? '', setCopiedAddr)}
              accessibilityLabel={loc.transactions.details_copy}
            />
            <View style={[styles.divider, stylesHook.divider]} />

            <DetailRow
              label={loc.send.transaction_id}
              value={txid}
              mono
              copied={copiedTxid}
              onCopy={() => copy(txid, setCopiedTxid)}
              accessibilityLabel={loc.transactions.details_copy_txid}
            />
            <View style={[styles.divider, stylesHook.divider]} />
          </View>

          <View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, stylesHook.summaryLabel]}>{loc.send.network_fee}</Text>
              <Text style={[styles.summaryValue, stylesHook.summaryValue]}>
                {satoshiToBTC(feeSatoshi)} {loc.units[BitcoinUnit.BTC]}
                <Text style={[styles.summaryFiat, stylesHook.summaryFiat]}> ({satoshiToLocalCurrency(feeSatoshi)})</Text>
              </Text>
            </View>
            <View style={[styles.divider, stylesHook.divider]} />

            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, stylesHook.totalLabel]}>{loc.send.total}</Text>
              <Text style={[styles.totalValue, stylesHook.totalValue]}>
                {satoshiToBTC(totalSats)} {loc.units[BitcoinUnit.BTC]}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.bottom}>
        {state.isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : (
          <Pressable
            accessibilityRole="button"
            testID="sendNowButton"
            disabled={state.isButtonDisabled}
            onPress={handleSendTransaction}
            style={[styles.sendNowButton, stylesHook.sendNowButton, state.isButtonDisabled && stylesHook.sendNowButtonDisabled]}
          >
            <SendIcon size={20} color={colors.white} />
            <Text style={[styles.sendNowText, stylesHook.sendNowText]}>{loc.send.confirm_sendNow}</Text>
          </Pressable>
        )}
      </View>
    </SafeArea>
  );
};

export default Confirm;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 19,
    justifyContent: 'space-between',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 12,
  },
  testnetBadge: {
    marginBottom: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  detailsGroup: {
    marginTop: -10,
  },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: {
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 26,
  },
  summaryValue: {
    fontFamily: ClashFont.medium,
    fontSize: 14,
    lineHeight: 17,
    letterSpacing: -0.104281,
  },
  summaryFiat: {
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 17,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  totalLabel: {
    fontFamily: ClashFont.regular,
    fontSize: 12,
    lineHeight: 20,
  },
  totalValue: {
    fontFamily: ClashFont.medium,
    fontSize: 14,
    lineHeight: 26,
  },
  bottom: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  sendNowButton: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  sendNowText: {
    fontFamily: ClashFont.medium,
    fontSize: 16,
    lineHeight: 24,
  },
});
