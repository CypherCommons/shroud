import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BackHandler, InteractionManager, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Share from 'react-native-share';
import * as Electrum from '../../modules/Electrum';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { ShroudText } from '../../ShroudComponents';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import AddressCopyCard from '../../components/AddressCopyCard';
import presentAlert from '../../components/Alert';
import { BottomModalHandle } from '../../components/BottomModal';
import ShareIcon from '../../components/icons/ShareIcon';
import InfoBanner from '../../components/InfoBanner';
import InspectAddressSheet from '../../components/InspectAddressSheet';
import PillSegmentedControl from '../../components/PillSegmentedControl';
import QRCard from '../../components/QRCard';
import TabPager from '../../components/TabPager';
import { useTheme } from '../../components/themes';
import { TransactionPendingIconBig } from '../../components/TransactionPendingIconBig';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc, { formatBalance } from '../../loc';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { ReceiveDetailsStackParamList } from '../../navigation/ReceiveDetailsStackParamList';
import { SuccessView } from '../send/success';
import { Spacing40 } from '../../components/Spacing';
import { Loading } from '../../components/Loading';
import { ClashFont } from '../../constants/fonts';

// One entry per tab: the pill's labels and the pager's pages both follow this order.
const TABS = [
  { key: 'silentPayments', label: loc.bip352.silent_payments },
  { key: 'standard', label: loc.wallets.details_address },
] as const;
type Tab = (typeof TABS)[number]['key'];
const TAB_LABELS = TABS.map(tab => tab.label);
const HORIZONTAL_PADDING = 24;
const qrLogo = require('../../img/logo.png');

type TabsHeaderProps = {
  selectedIndex: number;
  onChange: (index: number) => void;
};

const TabsHeader = React.memo(({ selectedIndex, onChange }: TabsHeaderProps) => (
  <View style={styles.tabsContainer}>
    <PillSegmentedControl values={TAB_LABELS} selectedIndex={selectedIndex} onChange={onChange} />
  </View>
));

type NavigationProps = NativeStackNavigationProp<ReceiveDetailsStackParamList, 'ReceiveDetails'>;
type RouteProps = RouteProp<ReceiveDetailsStackParamList, 'ReceiveDetails'>;

const ReceiveDetails = () => {
  const { walletID, address } = useRoute<RouteProps>().params;
  const { wallets, saveToDisk, sleep, fetchAndSaveWalletTransactions } = useStorage();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inspectSheetRef = useRef<BottomModalHandle>(null);
  const [bip21encoded, setBip21encoded] = useState('');
  const [showPendingBalance, setShowPendingBalance] = useState(false);
  const [showConfirmedBalance, setShowConfirmedBalance] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const [currentTab, setCurrentTab] = useState<Tab>('silentPayments');
  const { goBack, setParams } = useExtendedNavigation<NavigationProps>();
  const [intervalMs, setIntervalMs] = useState(5000);
  const [eta, setEta] = useState('');
  const [initialConfirmed, setInitialConfirmed] = useState(0);
  const [initialUnconfirmed, setInitialUnconfirmed] = useState(0);
  const [displayBalance, setDisplayBalance] = useState('');

  const wallet = walletID ? wallets.find(w => w.getID() === walletID) : undefined;
  const spAddress =
    wallet && 'getSilentPaymentAddress' in wallet && typeof wallet.getSilentPaymentAddress === 'function'
      ? wallet.getSilentPaymentAddress()
      : undefined;

  const selectedTabIndex = TABS.findIndex(tab => tab.key === currentTab);
  const selectTab = useCallback((index: number) => setCurrentTab(TABS[index].key), []);
  const presentInspectSheet = useCallback(() => inspectSheetRef.current?.present(), []);

  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.background,
    },
    label: {
      color: colors.textSecondary,
    },
  });

  const setAddressBIP21Encoded = useCallback(
    (addr: string) => {
      const newBip21encoded = DeeplinkSchemaMatch.bip21encode(addr);
      setParams({ address: addr });
      setBip21encoded(newBip21encoded);
      setShowAddress(true);
    },
    [setParams],
  );

  const obtainWalletAddress = useCallback(async () => {
    console.debug('ReceiveDetails - componentDidMount');
    // this function should only be called when wallet exists
    if (!wallet) {
      console.warn('Wallet not found');
      return;
    }
    if (address) {
      setAddressBIP21Encoded(address);
      return;
    }

    let newAddress;
    try {
      newAddress = await Promise.race([wallet.getAddressAsync(), sleep(1000)]);
    } catch (error) {
      console.warn('Error fetching wallet address:', error);
    }
    if (newAddress === undefined) {
      newAddress = wallet._getExternalAddressByIndex(wallet.getNextFreeAddressIndex());
    } else {
      saveToDisk(); // caching whatever getAddressAsync() generated internally
    }

    if (!newAddress) {
      presentAlert({ title: loc.errors.error, message: loc.receive.address_not_found });
      return;
    }

    setAddressBIP21Encoded(newAddress);
  }, [wallet, saveToDisk, address, setAddressBIP21Encoded, sleep]);

  useEffect(() => {
    if (showConfirmedBalance) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
    }
  }, [showConfirmedBalance]);

  useEffect(() => {
    if (address) {
      setAddressBIP21Encoded(address);
    }
  }, [address, setAddressBIP21Encoded]);

  // re-fetching address balance periodically
  useEffect(() => {
    console.debug('receive/details - useEffect');

    const intervalId = setInterval(async () => {
      try {
        const decoded = DeeplinkSchemaMatch.bip21decode(bip21encoded);
        const addressToUse = address || decoded.address;
        if (!addressToUse) return;

        console.debug('checking address', addressToUse, 'for balance...');
        const balance = await Electrum.getBalanceByAddress(addressToUse);
        console.debug('...got', balance);

        if (balance.unconfirmed > 0) {
          if (initialConfirmed === 0 && initialUnconfirmed === 0) {
            setInitialConfirmed(balance.confirmed);
            setInitialUnconfirmed(balance.unconfirmed);
            setIntervalMs(25000);
            triggerHapticFeedback(HapticFeedbackTypes.ImpactHeavy);
          }

          const txs = await Electrum.getMempoolTransactionsByAddress(addressToUse);
          const tx = txs.pop();
          if (tx) {
            const rez = await Electrum.multiGetTransactionByTxid([tx.tx_hash], true, 10);
            if (rez[tx.tx_hash] && rez[tx.tx_hash].vsize) {
              const satPerVbyte = Math.round(tx.fee / rez[tx.tx_hash].vsize);
              const fees = await Electrum.estimateFees();
              if (satPerVbyte >= fees.fast) {
                setEta(loc.formatString(loc.transactions.eta_10m));
              } else if (satPerVbyte >= fees.medium) {
                setEta(loc.formatString(loc.transactions.eta_3h));
              } else {
                setEta(loc.formatString(loc.transactions.eta_1d));
              }
            }
          }

          setDisplayBalance(
            loc.formatString(loc.transactions.pending_with_amount, {
              amt1: formatBalance(balance.unconfirmed, BitcoinUnit.LOCAL_CURRENCY, true).toString(),
              amt2: formatBalance(balance.unconfirmed, BitcoinUnit.BTC, true).toString(),
            }),
          );
          setShowPendingBalance(true);
          setShowAddress(false);
        } else if (balance.unconfirmed === 0 && initialUnconfirmed !== 0) {
          // now, handling a case when unconfirmed == 0, but in past it wasnt (i.e. it changed while user was
          // staring at the screen)
          const balanceToShow = balance.confirmed - initialConfirmed;

          if (balanceToShow > 0) {
            // address has actually more coins than initially, so we definitely gained something
            setShowConfirmedBalance(true);
            setShowPendingBalance(false);
            setShowAddress(false);
            setDisplayBalance(
              loc.formatString(loc.transactions.received_with_amount, {
                amt1: formatBalance(balanceToShow, BitcoinUnit.LOCAL_CURRENCY, true).toString(),
                amt2: formatBalance(balanceToShow, BitcoinUnit.BTC, true).toString(),
              }),
            );
            if (walletID) {
              fetchAndSaveWalletTransactions(walletID);
            }
          } else {
            // rare case, but probable. transaction evicted from mempool (maybe cancelled by the sender)
            setShowConfirmedBalance(false);
            setShowPendingBalance(false);
            setShowAddress(true);
          }
        }
      } catch (error) {
        console.debug('Error checking balance:', error);
      }
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [bip21encoded, address, initialConfirmed, initialUnconfirmed, intervalMs, fetchAndSaveWalletTransactions, walletID]);

  useEffect(() => {
    const handleBackButton = () => {
      goBack();
      return true;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackButton);
    return () => subscription.remove();
  }, [goBack]);

  const renderConfirmedBalance = () => {
    return (
      <View style={styles.scrollBody}>
        <SuccessView />
        <ShroudText style={[styles.label, stylesHook.label]} numberOfLines={1}>
          {displayBalance}
        </ShroudText>
      </View>
    );
  };

  const renderPendingBalance = () => {
    return (
      <View style={styles.scrollBody}>
        <TransactionPendingIconBig />
        <Spacing40 />
        <ShroudText style={[styles.label, stylesHook.label]} numberOfLines={1}>
          {displayBalance}
        </ShroudText>
        <ShroudText style={[styles.label, stylesHook.label]} numberOfLines={1}>
          {eta}
        </ShroudText>
      </View>
    );
  };

  const renderTabPage = (tab: Tab) => {
    if (tab === 'silentPayments') {
      return spAddress ? (
        <View style={styles.addressBody}>
          <InfoBanner text={loc.bip352.explanation} emphasis={loc.bip352.explanation_emphasis} />
          <QRCard value={spAddress} logo={qrLogo} />
          <AddressCopyCard text={spAddress} onInspect={presentInspectSheet} />
        </View>
      ) : (
        <ShroudText>{loc.bip352.not_supported}</ShroudText>
      );
    }
    return address ? (
      <View style={styles.addressBody}>
        <InfoBanner text={loc.receive.standard_address_notice} emphasis={loc.receive.standard_address_notice_emphasis} variant="caution" />
        <QRCard value={bip21encoded} logo={qrLogo} />
        <AddressCopyCard text={address} onInspect={presentInspectSheet} testID="StandardAddressCopyCard" />
      </View>
    ) : null;
  };

  const renderTabContent = () => {
    if (!wallet) return null;
    return (
      <TabPager selectedIndex={selectedTabIndex} onChange={selectTab} testID="ReceiveTabPager">
        {TABS.map(tab => (
          <View key={tab.key} style={styles.page}>
            {renderTabPage(tab.key)}
          </View>
        ))}
      </TabPager>
    );
  };

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(async () => {
        try {
          if (wallet) {
            await obtainWalletAddress();
          } else if (!wallet && address) {
            setAddressBIP21Encoded(address);
          }
        } catch (error) {
          console.error('Error during focus effect:', error);
        }
      });
      return () => {
        task.cancel();
      };
    }, [wallet, address, obtainWalletAddress, setAddressBIP21Encoded]),
  );

  const handleShareButtonPressed = () => {
    const message = currentTab === 'standard' ? bip21encoded : spAddress;

    if (!message) {
      presentAlert({ title: loc.errors.error, message: loc.receive.address_not_found });
      return;
    }

    Share.open({ message }).catch(error => console.debug('Error sharing:', error));
  };

  const shareDisabled = currentTab === 'standard' ? !bip21encoded : !spAddress;

  return (
    <View style={[styles.flex, stylesHook.root]}>
      {wallet && <TabsHeader selectedIndex={selectedTabIndex} onChange={selectTab} />}
      {/* The content is sized to fit, so this only scrolls when even the smallest QR code can't (e.g. landscape). */}
      <ScrollView
        testID="ReceiveDetailsScrollView"
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        alwaysBounceVertical={false}
      >
        {showAddress && renderTabContent()}
        {showConfirmedBalance && renderConfirmedBalance()}
        {showPendingBalance && renderPendingBalance()}

        {!showAddress && !showPendingBalance && !showConfirmedBalance && (
          <View style={styles.loadingContainer}>
            <Loading />
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        <Pressable
          onPress={handleShareButtonPressed}
          disabled={shareDisabled}
          accessibilityRole="button"
          android_ripple={{ color: colors.textMuted }}
          testID="ReceiveShareButton"
          style={({ pressed }) => [
            styles.shareButton,
            { backgroundColor: shareDisabled ? colors.ctaDisabled : colors.brandPrimary },
            pressed && !shareDisabled ? styles.sharePressed : null,
          ]}
        >
          <ShareIcon size={19} color={colors.white} />
          <ShroudText style={[styles.shareLabel, { color: colors.white }]}>{loc.receive.details_share}</ShroudText>
        </Pressable>
      </View>

      <InspectAddressSheet ref={inspectSheetRef} address={(currentTab === 'standard' ? address : spAddress) ?? undefined} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  tabsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 8,
  },
  scrollBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
  },
  shareLabel: {
    fontFamily: ClashFont.medium,
    fontSize: 16,
    lineHeight: 24,
  },
  sharePressed: {
    opacity: 0.85,
  },
  addressBody: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
    paddingBottom: 12,
  },
  // Fills the pager, which fills the space between the tabs and the Share button; the QR card then
  // takes whatever the banner and the address card leave.
  page: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
});

export default ReceiveDetails;
