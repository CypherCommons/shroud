import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import assert from 'assert';
import BigNumber from 'bignumber.js';
import { TOptions } from 'bip21';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, LayoutAnimation, ScrollView, StyleSheet, Text, Pressable, View } from 'react-native';
import { isSilentPaymentAddress } from '../../helpers/silent-payments';
import { getActiveNetwork } from '../../modules/network';
import { btcToSatoshi, satoshiToBTC, satoshiToLocalCurrency } from '../../modules/currency';
import triggerHapticFeedback, { HapticFeedbackTypes, triggerSelectionHapticFeedback } from '../../modules/hapticFeedback';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { CreateTransactionTarget, CreateTransactionUtxo, TWallet } from '../../class/wallets/types';
import presentAlert from '../../components/Alert';
import AmountHero from '../../components/AmountHero';
import Button from '../../components/Button';
import CoinsSelected from '../../components/CoinsSelected';
import { DismissKeyboardInputAccessory } from '../../components/DismissKeyboardInputAccessory';
import HeaderMenuButton from '../../components/HeaderMenuButton';
import ChevronRightIcon from '../../components/icons/ChevronRightIcon';
import ScanQRIcon from '../../components/icons/ScanQRIcon';
import ContactIcon from '../../components/icons/ContactIcon';
import ContactChip from '../../components/ContactChip';
import ContactPickerSheet from '../../components/ContactPickerSheet';
import SaveContactRow from '../../components/SaveContactRow';
import { BottomModalHandle } from '../../components/BottomModal';
import FieldTextInput, { FieldAddressInput } from '../../components/FieldTextInput';
import LabeledField from '../../components/LabeledField';
import SafeArea from '../../components/SafeArea';
import { shadowSm, useTheme } from '../../components/themes';
import { Action } from '../../components/types';
import { ClashFont } from '../../constants/fonts';
import { isAmountEmpty, sanitizeAmountInput, displayAmountForUnit, feeSpeedTierForRate } from '../../helpers/send/format';
import { useStorage } from '../../hooks/context/useStorage';
import { useContacts } from '../../hooks/context/useContacts';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useKeyboard } from '../../hooks/useKeyboard';
import loc, { formatBalance } from '../../loc';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import NetworkTransactionFees, { NetworkTransactionFee, NetworkTransactionFeeType } from '../../models/networkTransactionFees';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';
import { CommonToolTipActions, ToolTipAction } from '../../typings/CommonToolTipActions';
import ActionSheet from '../ActionSheet';

interface IPaymentDestinations {
  address: string; // btc address or payment code
  amountSats?: number | string;
  amount?: string | number | 'MAX';
  key: string; // random id to look up this record
  unit: BitcoinUnit;
}

export interface IFee {
  current: number | null;
  slowFee: number | null;
  mediumFee: number | null;
  fastestFee: number | null;
}
type NavigationProps = NativeStackNavigationProp<SendDetailsStackParamList, 'SendDetails'>;
type RouteProps = RouteProp<SendDetailsStackParamList, 'SendDetails'>;

const SendDetails = () => {
  const { wallets, sleep, txMetadata, saveToDisk } = useStorage();
  const navigation = useExtendedNavigation<NavigationProps>();
  const selectedDataProcessor = useRef<ToolTipAction | undefined>(undefined);
  const setParams = navigation.setParams;
  const route = useRoute<RouteProps>();
  const feeUnit = route.params?.feeUnit ?? BitcoinUnit.BTC;
  const amountUnit = route.params?.amountUnit ?? BitcoinUnit.BTC;
  const frozenBalance = route.params?.frozenBalance ?? 0;
  const transactionMemo = route.params?.transactionMemo;
  const utxos = route.params?.utxos;
  const isTransactionReplaceable = route.params?.isTransactionReplaceable;
  const routeParams = route.params;
  const { colors } = useTheme();
  const { contactList, getContact } = useContacts();

  // state
  const [isLoading, setIsLoading] = useState(false);
  const contactSheetRef = useRef<BottomModalHandle>(null);
  const [wallet, setWallet] = useState<TWallet | null>(null);
  const { isVisible } = useKeyboard();
  const [addresses, setAddresses] = useState<IPaymentDestinations[]>([{ address: '', key: String(Math.random()), unit: amountUnit }]);
  const [networkTransactionFees, setNetworkTransactionFees] = useState(new NetworkTransactionFee(3, 2, 1));
  const [customFee, setCustomFee] = useState<string | null>(null);
  const [selectedPresetFeeRate, setSelectedPresetFeeRate] = useState<string | null>(null);
  const [feePrecalc, setFeePrecalc] = useState<IFee>({ current: null, slowFee: null, mediumFee: null, fastestFee: null });
  const [changeAddress, setChangeAddress] = useState<string | null>(null);
  const [dumb, setDumb] = useState(false);
  const [displayUnit, setDisplayUnit] = useState<BitcoinUnit>(BitcoinUnit.BTC);
  const { isEditable } = routeParams;
  // if utxo is limited we use it to calculate available balance
  const balance: number = utxos ? utxos.reduce((prev, curr) => prev + curr.value, 0) : (wallet?.getBalance() ?? 0);
  // single-recipient helpers
  const recipient = addresses[0];
  const isMaxActive = recipient?.amount === BitcoinUnit.MAX;
  const displayAmount = isMaxActive
    ? displayAmountForUnit(String(satoshiToBTC(balance)), balance, displayUnit)
    : displayAmountForUnit(recipient?.amount ? String(recipient.amount) : '', Number(recipient?.amountSats), displayUnit);
  // when sending max, amountSats holds the 'MAX' sentinel, so derive the fiat estimate from the full balance
  const amountSatsNum = isMaxActive ? balance : Number(recipient?.amountSats) || 0;
  const fiatEstimate = `≈ ${satoshiToLocalCurrency(amountSatsNum)}`;
  const isFormValid = !!recipient?.address && amountSatsNum > 0;
  const hasFeeEstimate = !!feePrecalc.current && amountSatsNum > 0;

  const onChangeAmount = useCallback(
    (text: string) => {
      const sanitized = sanitizeAmountInput(text, displayUnit);
      setAddresses(addrs => {
        const a = { ...addrs[0] };
        if (displayUnit === BitcoinUnit.SATS) {
          const sats = sanitized === '' ? 0 : Number(sanitized);
          a.amountSats = sats;
          a.amount = sanitized === '' ? '' : satoshiToBTC(sats);
        } else {
          a.amount = sanitized;
          a.amountSats = btcToSatoshi(sanitized);
        }
        // canonical storage is always BTC; displayUnit is a view concern only
        a.unit = BitcoinUnit.BTC;
        return [a, ...addrs.slice(1)];
      });
    },
    [displayUnit],
  );

  const onToggleUnit = useCallback(() => {
    triggerSelectionHapticFeedback();
    setDisplayUnit(u => (u === BitcoinUnit.SATS ? BitcoinUnit.BTC : BitcoinUnit.SATS));
  }, []);

  const onChangeAddress = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const looksLikeUri = trimmed.includes(':') || trimmed.includes('?');
      if (looksLikeUri) {
        const { address, amount, memo } = DeeplinkSchemaMatch.decodeBitcoinUri(trimmed);
        setAddresses(addrs => {
          const a = { ...addrs[0] };
          a.address = address || trimmed;
          if (amount) {
            a.amount = String(amount);
            a.amountSats = btcToSatoshi(String(amount));
          }
          return [a, ...addrs.slice(1)];
        });
        if (memo) setParams({ transactionMemo: memo });
      } else {
        setAddresses(addrs => {
          const a = { ...addrs[0] };
          a.address = trimmed;
          return [a, ...addrs.slice(1)];
        });
      }
      setIsLoading(false);
    },
    [setParams],
  );

  // if cutomFee is not set, we need to choose highest possible fee for wallet balance
  // if there are no funds for even Slow option, use 1 sat/vbyte fee
  const feeRate = useMemo(() => {
    console.log('SendDetails: feeRate useMemo - customFee:', customFee);
    console.log('SendDetails: feeRate useMemo - selectedPresetFeeRate:', selectedPresetFeeRate);
    console.log('SendDetails: feeRate useMemo - feePrecalc:', feePrecalc);
    console.log('SendDetails: feeRate useMemo - networkTransactionFees:', networkTransactionFees);

    if (customFee) {
      console.log('SendDetails: Using customFee:', customFee);
      return customFee;
    }

    if (selectedPresetFeeRate) {
      console.log('SendDetails: Using selectedPresetFeeRate:', selectedPresetFeeRate);
      return selectedPresetFeeRate;
    }

    // If we have precalculated fees, use them to determine the default fee
    if (feePrecalc.slowFee !== null) {
      let initialFee;
      if (feePrecalc.fastestFee !== null) {
        initialFee = String(networkTransactionFees.fastestFee);
        console.log('SendDetails: Using fastestFee:', initialFee);
      } else if (feePrecalc.mediumFee !== null) {
        initialFee = String(networkTransactionFees.mediumFee);
        console.log('SendDetails: Using mediumFee:', initialFee);
      } else {
        initialFee = String(networkTransactionFees.slowFee);
        console.log('SendDetails: Using slowFee:', initialFee);
      }
      console.log('SendDetails: Final feeRate:', initialFee);
      return initialFee;
    }

    // If no precalc fees yet, default to fastestFee from network fees
    const defaultFee = String(networkTransactionFees.fastestFee);
    console.log('SendDetails: No precalc fees yet, using default networkTransactionFees.fastestFee:', defaultFee);
    return defaultFee;
  }, [customFee, selectedPresetFeeRate, feePrecalc, networkTransactionFees]);

  useEffect(() => {
    // decode route params
    const currentAddress = addresses[0];
    if (routeParams.uri) {
      try {
        const { address, amount, memo } = DeeplinkSchemaMatch.decodeBitcoinUri(routeParams.uri);

        setAddresses(addrs => {
          addrs[0].unit = BitcoinUnit.BTC;
          return [...addrs];
        });

        setAddresses(addrs => {
          if (currentAddress) {
            currentAddress.address = address;
            if (Number(amount) > 0) {
              currentAddress.amount = amount!;
              currentAddress.amountSats = btcToSatoshi(amount!);
            }
            addrs[0] = currentAddress;
            return [...addrs];
          } else {
            return [...addrs, { address, amount, amountSats: btcToSatoshi(amount!), key: String(Math.random()), unit: amountUnit }];
          }
        });

        if (memo?.trim().length > 0) {
          setParams({ transactionMemo: memo });
        }
        setParams({ amountUnit: BitcoinUnit.BTC });
      } catch (error) {
        console.log(error);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ title: loc.errors.error, message: loc.send.details_error_decode });
      }
    } else if (routeParams.address) {
      // screen was called with `address` parameter, so we just prefill it
      setAddresses(prevAddresses => {
        const updatedAddresses = [...prevAddresses];
        updatedAddresses[0] = {
          ...updatedAddresses[0],
          address: routeParams.address!,
          amount: 0,
          amountSats: 0,
        };
        return updatedAddresses;
      });
    } else if (routeParams.addRecipientParams) {
      // used to add a recipient, mainly from contacts aka paymentcodes screen
      const { address, amount } = routeParams.addRecipientParams;

      setAddresses(prevAddresses => {
        const updatedAddresses = [...prevAddresses];
        if (address) {
          updatedAddresses[0] = {
            ...updatedAddresses[0],
            address,
            amount: amount ?? updatedAddresses[0].amount,
            amountSats: amount ? btcToSatoshi(amount) : updatedAddresses[0].amountSats,
          };
        }
        return updatedAddresses;
      });

      // @ts-ignore: Fix later
      setParams(prevParams => ({ ...prevParams, addRecipientParams: undefined }));
    } else {
      setAddresses([{ address: '', key: String(Math.random()), unit: amountUnit }]);
    }
    // this effect only to run once when screen is mounted or params change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParams.uri, routeParams.address, routeParams.addRecipientParams]);

  useEffect(() => {
    // check if we have a suitable wallet
    const suitable = wallets.filter(w => w.chain === Chain.ONCHAIN && w.allowSend());
    if (suitable.length === 0) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      presentAlert({ title: loc.errors.error, message: loc.send.details_wallet_before_tx });
      navigation.goBack();
      return;
    }
    const newWallet = (routeParams.walletID && wallets.find(w => w.getID() === routeParams.walletID)) || suitable[0];
    setWallet(newWallet);
    setParams({ feeUnit: newWallet.getPreferredBalanceUnit(), amountUnit: newWallet.getPreferredBalanceUnit() });

    // we are ready!
    setIsLoading(false);

    // load cached fees
    AsyncStorage.getItem(NetworkTransactionFee.StorageKey)
      .then(res => {
        if (!res) return;
        const fees = JSON.parse(res);
        if (!fees?.fastestFee) return;
        setNetworkTransactionFees(fees);
      })
      .catch(e => console.log('loading cached recommendedFees error', e));

    // load fresh fees from servers

    NetworkTransactionFees.recommendedFees()
      .then(async fees => {
        if (!fees?.fastestFee) return;
        setNetworkTransactionFees(fees);
        await AsyncStorage.setItem(NetworkTransactionFee.StorageKey, JSON.stringify(fees));
      })
      .catch(e => console.log('loading recommendedFees error', e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // change header and reset state on wallet change
  useEffect(() => {
    if (!wallet) return;

    // reset other values
    setChangeAddress(null);
    setParams({
      utxos: null,
      isTransactionReplaceable: wallet.type === HDSilentPaymentsWallet.type && !routeParams.isTransactionReplaceable ? true : undefined,
    });
    // update wallet UTXO
    wallet
      .fetchUtxo()
      .then(() => {
        // we need to re-calculate fees
        setDumb(v => !v);
      })
      .catch(e => console.log('fetchUtxo error', e));
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  // recalc fees in effect so we don't block render
  useEffect(() => {
    if (!wallet) return; // wait for it
    const fees = networkTransactionFees;
    const requestedSatPerByte = Number(feeRate);
    const lutxo = (utxos || wallet.getUtxo()) as CreateTransactionUtxo[];
    let frozen = 0;
    if (!utxos) {
      // if utxo is not limited search for frozen outputs and calc it's balance
      frozen = wallet
        .getUtxo(true)
        .filter(o => !lutxo.some(i => i.txid === o.txid && i.vout === o.vout))
        .reduce((prev, curr) => prev + curr.value, 0);
    }

    const options = [
      { key: 'current', fee: requestedSatPerByte },
      { key: 'slowFee', fee: fees.slowFee },
      { key: 'mediumFee', fee: fees.mediumFee },
      { key: 'fastestFee', fee: fees.fastestFee },
    ] as const;

    const newFeePrecalc: /* Record<string, any> */ IFee = { ...feePrecalc };

    let targets = [];
    for (const transaction of addresses) {
      if (transaction.amount === BitcoinUnit.MAX) {
        // single output with MAX
        targets = [{ address: transaction.address }];
        break;
      }
      const value = transaction.amountSats;
      if (Number(value) > 0) {
        targets.push({ address: transaction.address, value });
      } else if (transaction.amount) {
        if (btcToSatoshi(transaction.amount) > 0) {
          targets.push({ address: transaction.address, value: btcToSatoshi(transaction.amount) });
        }
      }
    }

    // if targets is empty, insert dust
    if (targets.length === 0) {
      targets.push({ address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV', value: 546 });
    }

    // replace wrong addresses with dump
    targets = targets.map(t => {
      if (!wallet.isAddressValid(t.address)) {
        return { ...t, address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV' };
      } else {
        return t;
      }
    });

    for (const opt of options) {
      let flag = false;
      while (true) {
        try {
          const { fee } = wallet.coinselect(lutxo, targets, opt.fee);
          newFeePrecalc[opt.key] = fee;
          break;
        } catch (e: any) {
          if (e.message.includes('Not enough') && !flag) {
            flag = true;
            targets = targets.map((t, index) => (index > 0 ? { ...t, value: 546 } : { address: t.address }));
            continue;
          }
          newFeePrecalc[opt.key] = null;
          break;
        }
      }
    }

    setFeePrecalc(newFeePrecalc);
    setParams({ frozenBalance: frozen });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, networkTransactionFees, utxos, addresses, feeRate, dumb]);

  // we need to re-calculate fees if user opens-closes coin control
  useFocusEffect(
    useCallback(() => {
      setIsLoading(false);
      setDumb(v => !v);
      return () => {};
    }, []),
  );

  const getChangeAddressAsync = async () => {
    if (changeAddress) return changeAddress; // cache

    let change;
    // call widely-used getChangeAddressAsync()
    try {
      change = await Promise.race([sleep(2000), wallet?.getChangeAddressAsync()]);
    } catch (_) {}

    if (!change) {
      // either sleep expired or getChangeAddressAsync threw an exception
      change = wallet!._getInternalAddressByIndex(wallet!.getNextFreeChangeAddressIndex());
    }

    if (change) setChangeAddress(change); // cache

    return change;
  };
  /**
   * TODO: refactor this mess, get rid of regexp, use https://github.com/bitcoinjs/bitcoinjs-lib/issues/890 etc etc
   *
   * @param data {String} Can be address or `bitcoin:xxxxxxx` uri scheme, or invalid garbage
   */

  const processAddressData = useCallback(
    (data: string | { data?: any }) => {
      assert(wallet, 'Internal error: wallet not set');
      if (typeof data !== 'string') {
        data = String(data.data);
      }
      setIsLoading(true);
      if (!data.replace) {
        // user probably scanned PSBT and got an object instead of string..?
        setIsLoading(false);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        return presentAlert({ title: loc.errors.error, message: loc.send.details_address_field_is_not_valid });
      }

      const dataWithoutSchema = data.replace('bitcoin:', '').replace('BITCOIN:', '');
      if (wallet.isAddressValid(dataWithoutSchema) || isSilentPaymentAddress(dataWithoutSchema, getActiveNetwork().bitcoinjs)) {
        setAddresses(addrs => {
          addrs[0].address = dataWithoutSchema;
          return [...addrs];
        });
        setIsLoading(false);
        return;
      }

      let address = '';
      let options: TOptions;
      try {
        if (!data.toLowerCase().startsWith('bitcoin:')) data = `bitcoin:${data}`;
        const decoded = DeeplinkSchemaMatch.bip21decode(data);
        address = decoded.address;
        options = decoded.options;
      } catch (error) {
        data = data.replace(/(amount)=([^&]+)/g, '').replace(/(amount)=([^&]+)&/g, '');
        const decoded = DeeplinkSchemaMatch.bip21decode(data);
        decoded.options.amount = 0;
        address = decoded.address;
        options = decoded.options;
      }

      console.log('options', options);
      if (wallet.isAddressValid(address)) {
        setAddresses(addrs => {
          addrs[0].address = address;
          addrs[0].amount = options?.amount ?? 0;
          addrs[0].amountSats = new BigNumber(options?.amount ?? 0).multipliedBy(100000000).toNumber();
          return [...addrs];
        });
        setAddresses(addrs => {
          addrs[0].unit = BitcoinUnit.BTC;
          return [...addrs];
        });
        setParams({ transactionMemo: options.label || '', amountUnit: BitcoinUnit.BTC }); // there used to be `options.message` here as well. bug?
      }

      setIsLoading(false);
    },
    [setParams, wallet],
  );

  const createTransaction = async () => {
    assert(wallet, 'Internal error: wallet is not set');
    Keyboard.dismiss();
    setIsLoading(true);
    const requestedSatPerByte = feeRate;
    for (const transaction of addresses) {
      let error;
      if (!transaction.amount || Number(transaction.amount) < 0 || parseFloat(String(transaction.amount)) === 0) {
        error = loc.send.details_amount_field_is_not_valid;
        console.log('validation error');
      } else if (parseFloat(String(transaction.amountSats)) <= 500) {
        error = loc.send.details_amount_field_is_less_than_minimum_amount_sat;
        console.log('validation error');
      } else if (!requestedSatPerByte || parseFloat(requestedSatPerByte) < 0) {
        error = loc.send.details_fee_field_is_not_valid;
        console.log('validation error');
      } else if (!transaction.address) {
        error = loc.send.details_address_field_is_not_valid;
        console.log('validation error');
      } else if (balance - Number(transaction.amountSats) < 0) {
        // first sanity check is that sending amount is not bigger than available balance
        error = frozenBalance > 0 ? loc.send.details_total_exceeds_balance_frozen : loc.send.details_total_exceeds_balance;
        console.log('validation error');
      } else if (transaction.address) {
        // address validation handled below
      }

      if (!error) {
        const isSilentPayment = isSilentPaymentAddress(transaction.address, getActiveNetwork().bitcoinjs);
        if (!wallet.isAddressValid(transaction.address) && !isSilentPayment) {
          console.log('validation error');
          error = loc.send.details_address_field_is_not_valid;
        } else if (isSilentPayment && !wallet.allowSilentPaymentSend()) {
          console.log('validation error');
          error = loc.send.cant_send_to_silentpayment_adress;
        }
      }

      if (error) {
        setIsLoading(false);
        presentAlert({ message: error });
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        return;
      }
    }

    try {
      await createPsbtTransaction();
    } catch (Err: any) {
      setIsLoading(false);
      presentAlert({ title: loc.errors.error, message: Err.message });
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
    }
  };
  const navigateToQRCodeScanner = useCallback(() => {
    navigation.navigate('ScanQRCode', {
      showFileImportButton: true,
    });
  }, [navigation]);

  // A saved payee is named by the chip above the address; an unsaved one gets the save affordance.
  const contact = getContact(recipient?.address ?? '');

  const onContactsPressed = useCallback(() => contactSheetRef.current?.present(), []);

  const onContactPicked = useCallback(
    (address: string) => {
      contactSheetRef.current?.dismiss();
      onChangeAddress(address);
    },
    [onChangeAddress],
  );

  const createPsbtTransaction = async () => {
    if (!wallet) return;

    const requestedSatPerByte = Number(feeRate);
    const lutxo: CreateTransactionUtxo[] = (utxos || (wallet?.getUtxo() ?? [])) as CreateTransactionUtxo[];
    console.log({ requestedSatPerByte, lutxo: lutxo.length });

    let change: string | undefined = await getChangeAddressAsync();

    // An SP wallet sends change to its label-0 silent payment address, but only when the
    // silent payment builder will actually run — the regular builder can't encode an sp1
    // change output. The wallet owns that decision so this screen and the builder agree.
    if (wallet.type === HDSilentPaymentsWallet.type) {
      change = (wallet as HDSilentPaymentsWallet).getChangeAddressForUtxos(lutxo, change);
    }

    assert(change, 'Could not get change address');

    const targets: CreateTransactionTarget[] = [];
    for (const transaction of addresses) {
      if (transaction.amount === BitcoinUnit.MAX) {
        // output with MAX
        targets.push({ address: transaction.address });
        continue;
      }
      const value = parseInt(String(transaction.amountSats), 10);
      if (value > 0) {
        targets.push({ address: transaction.address, value });
      } else if (transaction.amount) {
        if (btcToSatoshi(transaction.amount) > 0) {
          targets.push({ address: transaction.address, value: btcToSatoshi(transaction.amount) });
        }
      }
    }

    // without forcing `HDSegwitBech32Wallet` i had a weird ts error, complaining about last argument (fp)
    const { tx, outputs, psbt, fee } = (wallet as HDSilentPaymentsWallet)?.createTransaction(
      lutxo,
      targets,
      requestedSatPerByte,
      change,
      isTransactionReplaceable ? HDSilentPaymentsWallet.defaultRBFSequence : HDSilentPaymentsWallet.finalRBFSequence,
      false,
      0,
    );

    if (tx && routeParams.launchedBy && psbt) {
      console.warn('navigating back to ', routeParams.launchedBy);

      // @ts-ignore idk how to fix FIXME?

      navigation.navigate(routeParams.launchedBy, { psbt });
    }

    assert(tx, 'createTRansaction failed');

    txMetadata[tx.getId()] = {
      memo: transactionMemo,
    };
    await saveToDisk();

    let recipients = outputs.filter(({ address }) => address !== change);

    if (recipients.length === 0) {
      // special case. maybe the only destination in this transaction is our own change address..?
      // (ez can be the case for single-address wallet when doing self-payment for consolidation)
      recipients = outputs;
    }

    navigation.navigate('Confirm', {
      fee: new BigNumber(fee).dividedBy(100000000).toNumber(),
      memo: transactionMemo,
      walletID: wallet.getID(),
      tx: tx.toHex(),
      recipients,
      satoshiPerByte: requestedSatPerByte,
      // `recipients` (above) is post-createTransaction: for a silent-payment target its
      // address has already been replaced by the derived one-time on-chain output. Capture
      // the address as the user actually entered/picked it, before that substitution.
      recipientAddress: addresses.length === 1 ? addresses[0].address : undefined,
    });
    setIsLoading(false);
  };

  useEffect(() => {
    const newWallet = wallets.find(w => w.getID() === routeParams.walletID);
    if (newWallet) {
      setWallet(newWallet);
    }
  }, [routeParams.walletID, wallets]);

  const setTransactionMemo = (memo: string) => {
    setParams({ transactionMemo: memo });
  };

  useEffect(() => {
    const data = routeParams.onBarScanned;
    if (data) {
      processAddressData(data);
    }
    selectedDataProcessor.current = undefined;
    setParams({ onBarScanned: undefined });
  }, [routeParams.onBarScanned, setParams, processAddressData]);

  const handleCoinControl = useCallback(() => {
    if (!wallet) return;
    navigation.navigate('CoinControl', {
      walletID: wallet?.getID(),
    });
  }, [navigation, wallet]);

  const onReplaceableFeeSwitchValueChanged = useCallback(
    (value: boolean) => {
      setParams({ isTransactionReplaceable: value });
    },
    [setParams],
  );

  const onUseAllPressed = useCallback(() => {
    // toggle off if we're already sending max
    if (recipient?.amount === BitcoinUnit.MAX) {
      setAddresses(addrs => {
        const a = { ...addrs[0], amount: '', amountSats: 0, unit: BitcoinUnit.BTC };
        return [a, ...addrs.slice(1)];
      });
      return;
    }

    const applyMax = () => {
      Keyboard.dismiss();
      setAddresses(addrs => {
        const a = { ...addrs[0], amount: BitcoinUnit.MAX, amountSats: BitcoinUnit.MAX, unit: BitcoinUnit.BTC };
        return [a, ...addrs.slice(1)];
      });
    };

    // keep a confirmation only when frozen coins are present, otherwise apply max instantly
    if (frozenBalance > 0) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
      ActionSheet.showActionSheetWithOptions(
        {
          title: loc.send.details_adv_full,
          message: loc.send.details_adv_full_sure_frozen,
          options: [loc._.cancel, loc._.ok],
          cancelButtonIndex: 0,
        },
        buttonIndex => {
          if (buttonIndex === 1) applyMax();
        },
      );
      return;
    }

    applyMax();
  }, [recipient?.amount, frozenBalance]);
  // Header Right Button

  const headerRightOnPress = useCallback(
    (id: string) => {
      Keyboard.dismiss();
      if (id === CommonToolTipActions.SignPSBT.id) {
        selectedDataProcessor.current = CommonToolTipActions.SignPSBT;
        navigateToQRCodeScanner();
      } else if (id === CommonToolTipActions.SendMax.id) {
        onUseAllPressed();
      } else if (id === CommonToolTipActions.AllowRBF.id) {
        onReplaceableFeeSwitchValueChanged(!isTransactionReplaceable);
      } else if (id === CommonToolTipActions.CoinControl.id) {
        handleCoinControl();
      }
    },
    [navigateToQRCodeScanner, onUseAllPressed, onReplaceableFeeSwitchValueChanged, isTransactionReplaceable, handleCoinControl],
  );

  const headerRightActions = useCallback(() => {
    if (!wallet) return [];

    const walletActions: Action[][] = [];

    const isSendMaxUsed = addresses.some(element => element.amount === BitcoinUnit.MAX);
    const sendMaxAction: Action[] = [
      {
        ...CommonToolTipActions.SendMax,
        disabled: wallet.getBalance() === 0 || isSendMaxUsed,
        hidden: !isEditable || !(Number(wallet.getBalance()) > 0),
      },
    ];
    walletActions.push(sendMaxAction);

    walletActions.push([CommonToolTipActions.CoinControl]);

    walletActions.push([CommonToolTipActions.SignPSBT]);

    return walletActions;
  }, [addresses, isEditable, wallet]);

  // TODO: update the design of this as well
  const HeaderRight = useCallback(
    () => <HeaderMenuButton disabled onPressMenuItem={headerRightOnPress} actions={headerRightActions()} />,
    [headerRightOnPress, headerRightActions],
  );

  const setHeaderRightOptions = useCallback(() => {
    navigation.setOptions({
      headerRight: HeaderRight,
    });
  }, [HeaderRight, navigation]);

  useEffect(() => {
    console.log('send/details - useEffect');
    if (wallet) {
      setHeaderRightOptions();
    }
  }, [colors, wallet, isTransactionReplaceable, balance, addresses, isEditable, isLoading, setHeaderRightOptions]);

  // Handle selectedFeeRate and selectedFeeType returned from SelectFeeScreen
  useEffect(() => {
    const selectedFeeRate = routeParams.selectedFeeRate;
    const selectedFeeType = routeParams.selectedFeeType;

    console.log('SendDetails: Fee selection useEffect triggered');
    console.log('SendDetails: selectedFeeRate:', selectedFeeRate);
    console.log('SendDetails: selectedFeeType:', selectedFeeType);
    console.log('SendDetails: current customFee:', customFee);
    console.log('SendDetails: current selectedPresetFeeRate:', selectedPresetFeeRate);
    console.log('SendDetails: networkTransactionFees:', networkTransactionFees);

    if (selectedFeeRate !== undefined || selectedFeeType !== undefined) {
      console.log('SendDetails: Processing fee selection...');

      if (selectedFeeType === NetworkTransactionFeeType.CUSTOM) {
        console.log('SendDetails: CUSTOM fee selected, setting customFee to:', selectedFeeRate);
        // Custom fee was selected - set the custom fee rate and clear preset
        setCustomFee(selectedFeeRate || null);
        setSelectedPresetFeeRate(null);
      } else if (
        selectedFeeType === NetworkTransactionFeeType.FAST ||
        selectedFeeType === NetworkTransactionFeeType.MEDIUM ||
        selectedFeeType === NetworkTransactionFeeType.SLOW
      ) {
        console.log('SendDetails: Preset fee selected:', selectedFeeType);
        console.log('SendDetails: Setting selectedPresetFeeRate to:', selectedFeeRate);
        // Preset fee was selected - set the preset fee rate and clear custom fee
        setSelectedPresetFeeRate(selectedFeeRate || null);
        setCustomFee(null);
      }

      console.log('SendDetails: Clearing route params...');
      // Clear the parameters to prevent re-processing
      setParams({ selectedFeeRate: undefined, selectedFeeType: undefined });
    }
  }, [routeParams.selectedFeeRate, routeParams.selectedFeeType, networkTransactionFees, setParams, customFee, selectedPresetFeeRate]);

  const formatFee = (fee: number) => formatBalance(fee, feeUnit!, true);

  const feeEtaLabel = {
    fast: loc.send.fee_10m,
    medium: loc.send.fee_3h,
    slow: loc.send.fee_1d,
  }[feeSpeedTierForRate(Number(feeRate), networkTransactionFees.fastestFee, networkTransactionFees.mediumFee)];

  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.background,
    },
    scanBtn: { backgroundColor: colors.background },
    feeSummary: { borderColor: colors.accentSubtle, backgroundColor: colors.surfaceSubtle },
    feeSummaryDisabled: { borderColor: colors.borderDefault, backgroundColor: colors.surfaceBrandSubtle },
    feeSummaryLabel: { color: colors.textMuted },
    feeSummaryValue: { color: colors.textPrimary },
    feeSummaryTextDisabled: { color: colors.textDisabled },
    feeSummaryValueMeta: { color: colors.textMuted },
  });

  const renderCoinsSelected = () => {
    if (isVisible || !utxos?.length) return null;
    return (
      <View style={styles.select}>
        <CoinsSelected
          number={utxos.length}
          onContainerPress={handleCoinControl}
          onClose={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setParams({ utxos: null });
          }}
        />
      </View>
    );
  };

  return (
    <SafeArea style={[styles.root, stylesHook.root]}>
      <ScrollView
        testID="SendDetailsScrollView"
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        <AmountHero
          editable
          amount={displayAmount}
          fiat={fiatEstimate}
          unit={displayUnit}
          unitMarginBottom={8}
          onToggleUnit={onToggleUnit}
          onChangeAmount={onChangeAmount}
          showHint={isAmountEmpty(recipient?.amount)}
          onUseMax={onUseAllPressed}
          useMaxDisabled={balance <= 0}
          isMax={isMaxActive}
        />

        <View style={styles.fieldsGroup}>
          <View style={styles.fieldsPair}>
            <View style={styles.addressGroup}>
              <LabeledField
                label={loc.send.label_address}
                tinted={!!recipient?.address}
                trailing={
                  !recipient?.address ? (
                    <View style={styles.addressActions}>
                      <Pressable accessibilityRole="button" onPress={navigateToQRCodeScanner} style={[styles.scanBtn, stylesHook.scanBtn]}>
                        <ScanQRIcon color={colors.brandPrimary} size={20} />
                      </Pressable>
                      {/* Nothing to pick from means the button can only open an empty sheet. */}
                      {contactList.length > 0 && (
                        <Pressable
                          accessibilityRole="button"
                          onPress={onContactsPressed}
                          style={[styles.contactBtn, stylesHook.scanBtn]}
                          testID="SendDetailsContactsButton"
                          accessibilityLabel={loc.contacts.header}
                        >
                          <ContactIcon color={colors.brandPrimary} size={24} />
                        </Pressable>
                      )}
                    </View>
                  ) : undefined
                }
              >
                {contact && <ContactChip name={contact.name} colorIndex={contact.colorIndex} testID="SendDetailsContactChip" />}
                <FieldAddressInput
                  placeholder={loc.send.paste_or_scan}
                  value={recipient?.address}
                  onChangeText={onChangeAddress}
                  editable={isEditable}
                  testID="AddressInput"
                />
              </LabeledField>

              {/* The chip above already names a saved payee, so nothing stands in once this retires. */}
              <SaveContactRow address={recipient?.address} />
            </View>

            <LabeledField label={loc.send.label_note}>
              <FieldTextInput
                placeholder={loc.send.note_visible_to_you}
                value={transactionMemo}
                onChangeText={setTransactionMemo}
                editable={!isLoading}
                testID="NoteInput"
              />
            </LabeledField>
          </View>

          <Pressable
            testID="chooseFee"
            accessibilityRole="button"
            onPress={() => {
              Keyboard.dismiss();
              navigation.navigate('SelectFee', {
                networkTransactionFees,
                feePrecalc,
                feeRate,
                feeUnit,
                walletID: wallet?.getID() || '',
                customFee,
              });
            }}
            disabled={isLoading || !hasFeeEstimate}
            style={[styles.feeSummary, stylesHook.feeSummary, !hasFeeEstimate && stylesHook.feeSummaryDisabled]}
          >
            <View style={styles.feeSummaryTexts}>
              <Text style={[styles.feeSummaryLabel, hasFeeEstimate ? stylesHook.feeSummaryLabel : stylesHook.feeSummaryTextDisabled]}>
                {loc.send.network_fee}
              </Text>
              {hasFeeEstimate ? (
                <Text style={[styles.feeSummaryValue, stylesHook.feeSummaryValue]}>
                  {formatFee(feePrecalc.current!)}
                  <Text style={[styles.feeSummaryValueMeta, stylesHook.feeSummaryValueMeta]}>
                    {` · ${feeRate} ${loc.units.sat_vbyte} ≈ ${feeEtaLabel}`}
                  </Text>
                </Text>
              ) : (
                <Text style={[styles.feeSummaryValue, stylesHook.feeSummaryTextDisabled]}>{loc.send.enter_amount_to_estimate}</Text>
              )}
            </View>
            {hasFeeEstimate && <ChevronRightIcon color={colors.iconSecondary} />}
          </Pressable>
        </View>
      </ScrollView>

      <DismissKeyboardInputAccessory />

      {renderCoinsSelected()}

      <View style={styles.bottom}>
        <Button
          testID="sendNextButton"
          title={loc.send.details_next}
          disabled={!isFormValid || isLoading}
          onPress={createTransaction}
          borderRadius={16}
          style={styles.nextButton}
          textStyle={styles.nextButtonText}
        />
      </View>

      <ContactPickerSheet ref={contactSheetRef} onPick={onContactPicked} />
    </SafeArea>
  );
};

export default SendDetails;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  addressActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressGroup: { gap: 8 },
  select: {
    marginBottom: 24,
    marginHorizontal: 24,
    alignItems: 'center',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 24,
  },
  fieldsGroup: {
    gap: 20,
  },
  fieldsPair: {
    gap: 12,
  },
  scanBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowSm,
  },
  feeSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  feeSummaryTexts: {
    flex: 1,
  },
  feeSummaryLabel: {
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  feeSummaryValue: {
    fontFamily: ClashFont.medium,
    fontSize: 16,
    lineHeight: 24,
  },
  feeSummaryValueMeta: {
    fontFamily: ClashFont.regular,
  },
  bottom: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  nextButton: {
    height: 56,
    minHeight: 56,
    maxHeight: 56,
    borderWidth: 0,
    paddingHorizontal: 0,
  },
  nextButtonText: {
    fontFamily: ClashFont.medium,
    fontSize: 16,
    lineHeight: 26,
    marginHorizontal: 0,
  },
});
