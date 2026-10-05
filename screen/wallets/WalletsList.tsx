import React, { useCallback, useEffect, useReducer, useRef, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import useAppState from '../../hooks/useAppState';
import ScanProgressBar from '../../components/ScanProgressBar';
import { useScanActions, useScannableWallet } from '../../hooks/useScannableWallet';
import { InteractionManager, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import A from '../../modules/analytics';
import { getClipboardContent } from '../../modules/clipboard';
import { isDesktop } from '../../modules/environment';
import * as fs from '../../modules/fs';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import { ExtendedTransaction, Transaction, TWallet } from '../../class/wallets/types';
import presentAlert from '../../components/Alert';
import Toast from '../../components/Toast';
import { useTheme } from '../../components/themes';
import { TransactionListItem } from '../../components/TransactionListItem';
import { useSizeClass, SizeClass } from '../../modules/sizeClass';
import loc, { formatBalanceWithoutSuffix } from '../../loc';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import ActionSheet from '../ActionSheet';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useSendToAddress } from '../../hooks/useSendToAddress';
import { useStorage } from '../../hooks/context/useStorage';
import SafeAreaSectionList from '../../components/SafeAreaSectionList';
import { scanQrHelper } from '../../helpers/scan-qr.ts';
import QRScanIcon from '../../components/icons/QRScanIcon';
import { ClashFont } from '../../constants/fonts';
import { satoshiToLocalCurrency } from '../../modules/currency';
import SearchIcon from '../../components/icons/SearchIcon';
import ShieldReceiveIcon from '../../components/icons/ShieldReceiveIcon';
import ReceiveArrowIcon from '../../components/icons/ReceiveArrowIcon';
import PayArrowIcon from '../../components/icons/PayArrowIcon';
import ChevronRightIcon from '../../components/icons/ChevronRightIcon';
import AddIcon from '../../components/icons/AddIcon';
import ContactRow from '../../components/ContactRow';
import ContactsEmptyState from '../../components/ContactsEmptyState';
import EmptyStateCard from '../../components/EmptyStateCard';
import UnderlineTabs from '../../components/UnderlineTabs';
import { ContactListItem } from '../../class/contacts';
import { useContacts } from '../../hooks/context/useContacts';

// The second section holds whichever tab is selected, so it is named for the role, not the content.
// One section per row type, so the renderer knows what it holds instead of sniffing the value.
const WalletsListSections = { WALLET: 'WALLET', TRANSACTIONS: 'TRANSACTIONS', CONTACTS: 'CONTACTS' };

enum HomeTab {
  Transactions,
  Contacts,
}

// The wallet section's single row is its own key string; the list section holds whichever tab
// is selected.
type SectionItem = ExtendedTransaction | ContactListItem | string;

type SectionData = {
  key: string;
  data: Transaction[] | ContactListItem[] | string[];
};

enum ActionTypes {
  SET_LOADING,
  SET_WALLETS,
  SET_CURRENT_INDEX,
  SET_REFRESH_FUNCTION,
}

interface SetLoadingAction {
  type: ActionTypes.SET_LOADING;
  payload: boolean;
}

interface SetWalletsAction {
  type: ActionTypes.SET_WALLETS;
  payload: TWallet[];
}

interface SetCurrentIndexAction {
  type: ActionTypes.SET_CURRENT_INDEX;
  payload: number;
}

interface SetRefreshFunctionAction {
  type: ActionTypes.SET_REFRESH_FUNCTION;
  payload: () => void;
}

type WalletListAction = SetLoadingAction | SetWalletsAction | SetCurrentIndexAction | SetRefreshFunctionAction;

interface WalletListState {
  isLoading: boolean;
  wallets: TWallet[];
  currentWalletIndex: number;
  refreshFunction: () => void;
}

const initialState = {
  isLoading: false,
  wallets: [],
  currentWalletIndex: 0,
  refreshFunction: () => {},
};

function reducer(state: WalletListState, action: WalletListAction) {
  switch (action.type) {
    case ActionTypes.SET_LOADING:
      return { ...state, isLoading: action.payload };
    case ActionTypes.SET_WALLETS:
      return { ...state, wallets: action.payload };
    case ActionTypes.SET_CURRENT_INDEX:
      return { ...state, currentWalletIndex: action.payload };
    case ActionTypes.SET_REFRESH_FUNCTION:
      return { ...state, refreshFunction: action.payload };
    default:
      return state;
  }
}

type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'WalletsList'>;

const WalletsList: React.FC = () => {
  const [state, dispatch] = useReducer<React.Reducer<WalletListState, WalletListAction>>(reducer, initialState);
  const { isLoading } = state;
  const { sizeClass, isLarge } = useSizeClass();
  const { wallets, getTransactions, getBalance, refreshAllWalletTransactions, saveToDisk, scanState } = useStorage();
  const { currentAppState } = useAppState();
  const wasAutoPausedRef = useRef(false);
  const { colors } = useTheme();
  const navigation = useExtendedNavigation<NavigationProps>();
  const { contactList } = useContacts();
  const sendToAddress = useSendToAddress();
  const [activeTab, setActiveTab] = useState(HomeTab.Transactions);
  const dataSource = getTransactions(undefined, Infinity);
  const walletsCount = useRef<number>(wallets.length);
  const [showZeroBalanceToast, setShowZeroBalanceToast] = useState(false);
  const dismissToast = useCallback(() => setShowZeroBalanceToast(false), []);
  const triggerZeroBalanceToast = useCallback(() => setShowZeroBalanceToast(true), []);

  const stylesHook = useMemo(
    () => ({
      listHeaderBack: {
        backgroundColor: colors.background,
        paddingTop: sizeClass === SizeClass.Large ? 8 : 0,
      },
      walletContainer: {
        backgroundColor: colors.background,
      },
      trackPaymentBg: {
        backgroundColor: colors.surfaceSubtle,
        borderColor: colors.accentSubtle,
      },
      receiveBtnStyle: {
        backgroundColor: colors.surfaceBrandTint,
        borderColor: colors.brandPrimary,
      },
      scanBtnStyle: {
        backgroundColor: colors.background,
        borderColor: colors.accentSubtle,
        borderWidth: 1,
      },
      payBtnActive: {
        backgroundColor: colors.brandPrimary,
      },
      payBtnDisabled: {
        backgroundColor: colors.ctaDisabled,
      },
      foregroundText: {
        color: colors.textPrimary,
      },
      alternativeText: {
        color: colors.textMuted,
      },
      requestBtnLabel: {
        color: colors.textBrand,
      },
      payBtnLabel: {
        color: colors.white,
      },
      shareAddrStyle: {
        borderWidth: 1.63,
        borderColor: colors.accentSubtle,
        backgroundColor: colors.background,
      },
      shareAddrText: {
        color: colors.textBrand,
      },
    }),
    [colors, sizeClass],
  );

  const refreshWallets = useCallback(
    async (index: number | undefined, showLoadingIndicator = true, showUpdateStatusIndicator = false) => {
      dispatch({ type: ActionTypes.SET_LOADING, payload: showLoadingIndicator });
      try {
        await refreshAllWalletTransactions(index, showUpdateStatusIndicator);
      } catch (error) {
        console.error(error);
      } finally {
        dispatch({ type: ActionTypes.SET_LOADING, payload: false });
      }
    },
    [refreshAllWalletTransactions],
  );

  /**
   * Forcefully fetches TXs and balance for ALL wallets.
   * Triggered manually by user on pull-to-refresh.
   */
  const refreshTransactions = useCallback(() => {
    refreshWallets(undefined, true, true);
  }, [refreshWallets]);

  useEffect(() => {
    // Initial load of transactions without triggering scroll
    const initialLoad = async () => {
      try {
        await refreshAllWalletTransactions(undefined, true);
      } catch (error) {
        console.error(error);
      }
    };

    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(() => {
    console.debug('WalletsList onRefresh');
    refreshTransactions();
    // Optimized for Mac option doesn't like RN Refresh component. Menu Elements now handles it for macOS
  }, [refreshTransactions]);

  const verifyBalance = useCallback(() => {
    if (getBalance() !== 0) {
      A(A.ENUM.GOT_NONZERO_BALANCE);
    } else {
      A(A.ENUM.GOT_ZERO_BALANCE);
    }
  }, [getBalance]);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        verifyBalance();
      });

      return () => {
        task.cancel();
      };
    }, [verifyBalance]),
  );

  useEffect(() => {
    // new wallet added - no longer auto-scrolls
    if (!isLarge) {
      // Just update the count, no scrolling
      walletsCount.current = wallets.length;
    }
  }, [isLarge, wallets]);

  const scanWallet = useScannableWallet();
  const scanActions = useScanActions(scanWallet);

  useEffect(() => {
    if (!scanWallet) return;
    const isBackground = currentAppState === 'background' || currentAppState === 'inactive';
    if (isBackground && scanState.status === 'scanning') {
      wasAutoPausedRef.current = true;
      scanWallet.pauseScan();
    } else if (!isBackground && wasAutoPausedRef.current && scanState.status === 'paused') {
      wasAutoPausedRef.current = false;
      scanWallet.resumeScan();
    } else if (scanState.status !== 'paused' && scanState.status !== 'scanning') {
      // scan ended via another path (cancel/error/completion) — drop the stale flag so a
      // later manual pause isn't auto-resumed
      wasAutoPausedRef.current = false;
    }
  }, [currentAppState, scanState.status, scanWallet]);

  const onBarScanned = useCallback(
    (value: any) => {
      if (!value) return;
      try {
        DeeplinkSchemaMatch.navigationRouteFor({ url: value }, completionValue => {
          triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
          // @ts-ignore: for now
          navigation.navigate(...completionValue);
        });
      } catch (e: any) {
        presentAlert({ title: loc.errors.error, message: e.message });
      }
    },
    [navigation],
  );

  const openAddContact = useCallback(() => {
    navigation.navigate('ContactEdit', { mode: 'add' });
  }, [navigation]);

  const renderListHeaderComponent = useCallback(() => {
    const wallet = wallets.length > 0 ? wallets[0] : null;
    return (
      <View style={[styles.listHeaderBack, stylesHook.listHeaderBack]}>
        {wallet && (
          <TouchableOpacity
            style={[styles.trackPaymentBanner, stylesHook.trackPaymentBg]}
            onPress={() => navigation.navigate('TrackPayment')}
            activeOpacity={0.7}
            testID="TrackPaymentBanner"
          >
            <View style={styles.trackPaymentIconCircle}>
              <SearchIcon size={48} background={colors.background} stroke={colors.brandPrimary} />
            </View>
            <View style={styles.trackPaymentBannerContent}>
              <Text style={[styles.trackPaymentBannerTitle, stylesHook.foregroundText]}>{loc.track_payment.banner_title}</Text>
              <Text style={[styles.trackPaymentBannerSubtitle, stylesHook.alternativeText]}>{loc.track_payment.banner_subtitle}</Text>
            </View>
            <ChevronRightIcon color={colors.iconSecondary} />
          </TouchableOpacity>
        )}
        <View style={styles.tabRow}>
          <UnderlineTabs
            values={[loc.transactions.list_title, loc.contacts.header]}
            selectedIndex={activeTab}
            onChange={setActiveTab}
            testIDPrefix="HomeTab"
          />
          {/* The empty state carries its own add button, so this one would be the second on screen. */}
          {activeTab === HomeTab.Contacts && contactList.length > 0 && (
            <TouchableOpacity
              style={styles.addContactButton}
              onPress={openAddContact}
              accessibilityRole="button"
              testID="HomeAddContactButton"
            >
              <AddIcon size={24} color={colors.brandPrimary} />
              <Text style={[styles.addContactLabel, { color: colors.textBrand }]}>{loc.contacts.add}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }, [
    stylesHook.listHeaderBack,
    stylesHook.trackPaymentBg,
    stylesHook.foregroundText,
    stylesHook.alternativeText,
    navigation,
    wallets,
    activeTab,
    contactList.length,
    openAddContact,
    colors.background,
    colors.brandPrimary,
    colors.iconSecondary,
    colors.textBrand,
  ]);

  const renderTransactionListsRow = useCallback(
    (item: ExtendedTransaction) => (
      <TransactionListItem key={item.hash} item={item} itemPriceUnit={item.walletPreferredBalanceUnit} walletID={item.walletID} />
    ),
    [],
  );

  const openContactDetail = useCallback((address: string) => navigation.navigate('ContactDetail', { address }), [navigation]);

  // Prefixed: the Contacts screen tags its own bare rows `ContactListContact-`, and this screen
  // stays mounted underneath it.
  const renderContactRow = useCallback(
    (item: ContactListItem) => (
      <ContactRow
        key={item.address}
        variant="card"
        contact={item}
        onPress={openContactDetail}
        onPay={sendToAddress}
        style={styles.contactCard}
        testID={`HomeContact-${item.address}`}
      />
    ),
    [openContactDetail, sendToAddress],
  );

  const changeWalletBalanceUnit = useCallback(async () => {
    const wallet = wallets.length > 0 ? wallets[0] : null;
    if (!wallet) return;

    let newWalletPreferredUnit = wallet.getPreferredBalanceUnit();

    switch (newWalletPreferredUnit) {
      case BitcoinUnit.BTC:
        newWalletPreferredUnit = BitcoinUnit.SATS;
        break;
      case BitcoinUnit.SATS:
      default:
        newWalletPreferredUnit = BitcoinUnit.BTC;
        break;
    }

    wallet.preferredBalanceUnit = newWalletPreferredUnit;
    await saveToDisk();
  }, [wallets, saveToDisk]);

  const onScanButtonPressed = useCallback(() => {
    scanQrHelper().then(onBarScanned);
  }, [onBarScanned]);

  // Wrapped rather than passed straight to onPress, which would hand the touch event to the
  // recipient parameter.
  const onSendButtonPressed = useCallback(() => sendToAddress(), [sendToAddress]);

  const onReceiveButtonPressed = useCallback(() => {
    if (wallets.length > 0) {
      const wallet = wallets[0];
      navigation.navigate('ReceiveDetails', {
        walletID: wallet.getID(),
        address: '',
      });
    }
  }, [navigation, wallets]);

  const onZeroBalanceRequestPress = useCallback(() => {
    dismissToast();
    onReceiveButtonPressed();
  }, [dismissToast, onReceiveButtonPressed]);

  const pasteFromClipboard = useCallback(async () => {
    onBarScanned(await getClipboardContent());
  }, [onBarScanned]);

  const sendButtonLongPress = useCallback(async () => {
    const isClipboardEmpty = (await getClipboardContent())?.trim().length === 0;

    const options = [loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan];
    if (!isClipboardEmpty) {
      options.push(loc.wallets.paste_from_clipboard);
    }

    const props = { title: loc.send.header, options, cancelButtonIndex: 0 };

    ActionSheet.showActionSheetWithOptions(props, buttonIndex => {
      switch (buttonIndex) {
        case 0:
          break;
        case 1:
          fs.showImagePickerAndReadImage()
            .then(onBarScanned)
            .catch(error => {
              triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
              presentAlert({ title: loc.errors.error, message: error.message });
            });
          break;
        case 2:
          scanQrHelper().then(onBarScanned);
          break;
        case 3:
          if (!isClipboardEmpty) {
            pasteFromClipboard();
          }
          break;
      }
    });
  }, [onBarScanned, pasteFromClipboard]);

  const renderWalletItem = useCallback(() => {
    const wallet = wallets.length > 0 ? wallets[0] : null;
    if (!wallet) return null;

    const balance = wallet.getBalance();
    const preferredUnit = wallet.getPreferredBalanceUnit();
    const displayNum = String(formatBalanceWithoutSuffix(balance, preferredUnit, true));
    const fiatLine = `≈ ${satoshiToLocalCurrency(balance)}`;
    const hasBalance = balance > 0;

    return (
      <View style={[styles.walletSection, stylesHook.walletContainer]}>
        <TouchableOpacity onPress={changeWalletBalanceUnit} style={styles.balanceHeader}>
          <View style={styles.balanceRow}>
            <Text style={[styles.balanceNumber, stylesHook.foregroundText]} adjustsFontSizeToFit numberOfLines={1}>
              {displayNum}
            </Text>
            <Text style={[styles.balanceUnit, stylesHook.alternativeText]}>{preferredUnit}</Text>
          </View>
          <Text style={[styles.balanceFiat, stylesHook.alternativeText]}>{fiatLine}</Text>
        </TouchableOpacity>

        {scanWallet && <ScanProgressBar scanState={scanState} onResume={scanActions.resume} onRetry={scanActions.retry} />}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtnWide, stylesHook.receiveBtnStyle]}
            onPress={onReceiveButtonPressed}
            testID="HomeScreenReceiveButton"
            accessibilityRole="button"
          >
            <ReceiveArrowIcon color={colors.brandPrimary} size={28} />
            <Text style={[styles.actionBtnLabel, stylesHook.requestBtnLabel]}>{loc.wallets.request_button}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtnSquare, stylesHook.scanBtnStyle]}
            onPress={onScanButtonPressed}
            testID="HomeScreenScanButton"
            accessibilityRole="button"
            accessibilityLabel={loc.wallets.scan_qr_code}
          >
            <QRScanIcon color={colors.brandPrimary} size={22} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtnWide, styles.actionBtnNoBorder, hasBalance ? stylesHook.payBtnActive : stylesHook.payBtnDisabled]}
            onPress={hasBalance ? onSendButtonPressed : triggerZeroBalanceToast}
            onLongPress={hasBalance ? sendButtonLongPress : undefined}
            testID="HomeScreenSendButton"
            accessibilityRole="button"
            accessibilityHint={hasBalance ? undefined : loc.wallets.no_balance_hint}
          >
            <PayArrowIcon color={colors.white} size={28} />
            <Text style={[styles.actionBtnLabel, stylesHook.payBtnLabel]}>{loc.wallets.pay_button}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [
    wallets,
    stylesHook,
    colors,
    changeWalletBalanceUnit,
    scanWallet,
    scanActions,
    scanState,
    triggerZeroBalanceToast,
    onReceiveButtonPressed,
    onScanButtonPressed,
    onSendButtonPressed,
    sendButtonLongPress,
  ]);

  const renderSectionItem = useCallback(
    (item: { section: any; item: SectionItem }) => {
      switch (item.section.key) {
        case WalletsListSections.WALLET:
          return sizeClass === SizeClass.Large ? null : renderWalletItem();
        case WalletsListSections.CONTACTS:
          return renderContactRow(item.item as ContactListItem);
        case WalletsListSections.TRANSACTIONS:
          return renderTransactionListsRow(item.item as ExtendedTransaction);
        default:
          return null;
      }
    },
    [sizeClass, renderContactRow, renderTransactionListsRow, renderWalletItem],
  );

  const renderSectionHeader = useCallback(
    (section: { section: { key: any } }) => {
      if (sizeClass === SizeClass.Large) {
        return null;
      }

      switch (section.section.key) {
        case WalletsListSections.TRANSACTIONS:
        case WalletsListSections.CONTACTS:
          return renderListHeaderComponent();
        default:
          return null;
      }
    },
    [sizeClass, renderListHeaderComponent],
  );

  const renderEmptyCard = useCallback(() => {
    if (activeTab === HomeTab.Contacts) {
      return contactList.length === 0 ? <ContactsEmptyState onAdd={openAddContact} /> : null;
    }

    if (dataSource.length !== 0 || isLoading) return null;
    const wallet = wallets.length > 0 ? wallets[0] : null;
    return (
      <EmptyStateCard
        icon={<ShieldReceiveIcon size={94} />}
        title={loc.wallets.no_transactions_title}
        subtitle={loc.wallets.no_transactions_subtitle}
        testID="NoTransactionsMessage"
      >
        {wallet && (
          <TouchableOpacity
            style={[styles.shareAddressButton, stylesHook.shareAddrStyle]}
            onPress={() => navigation.navigate('ReceiveDetails', { walletID: wallet.getID(), address: '' })}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.shareAddressText, stylesHook.shareAddrText]}>{loc.wallets.share_address}</Text>
          </TouchableOpacity>
        )}
      </EmptyStateCard>
    );
  }, [
    activeTab,
    contactList.length,
    openAddContact,
    dataSource.length,
    isLoading,
    wallets,
    navigation,
    stylesHook.shareAddrStyle,
    stylesHook.shareAddrText,
  ]);

  // Contacts are keyed by address so switching tabs can't reuse a transaction's row identity.
  const sectionListKeyExtractor = useCallback(
    (item: SectionItem, index: number) => (typeof item === 'object' && 'address' in item ? `contact-${item.address}` : `${item}${index}`),
    [],
  );

  const refreshProps = isDesktop ? {} : { refreshing: isLoading, onRefresh };

  const sections: SectionData[] = useMemo(() => {
    const list: SectionData =
      activeTab === HomeTab.Contacts
        ? { key: WalletsListSections.CONTACTS, data: contactList }
        : { key: WalletsListSections.TRANSACTIONS, data: dataSource };

    // On large screens, only show the list section
    if (sizeClass === SizeClass.Large) {
      return [list];
    }

    // On smaller screens, show both wallet and list
    return [{ key: WalletsListSections.WALLET, data: [WalletsListSections.WALLET] }, list];
  }, [sizeClass, activeTab, contactList, dataSource]);

  return (
    <>
      <SafeAreaSectionList<any | string, SectionData>
        testID="WalletsListScrollView"
        contentContainerStyle={styles.sectionListContent}
        renderItem={renderSectionItem}
        keyExtractor={sectionListKeyExtractor}
        renderSectionHeader={renderSectionHeader}
        initialNumToRender={10}
        ListFooterComponent={renderEmptyCard}
        ListFooterComponentStyle={styles.emptyCardOuter}
        sections={sections}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        ignoreTopInset={true} // Ignore top inset as the screen header already handles it
        {...refreshProps}
      />
      <Toast
        visible={showZeroBalanceToast}
        title={loc.wallets.zero_balance_toast_title}
        subtitle={loc.wallets.zero_balance_toast_subtitle}
        action={{ label: loc.wallets.request_button, onPress: onZeroBalanceRequestPress, testID: 'ZeroBalanceToastRequestButton' }}
        onHide={dismissToast}
        testID="ZeroBalanceToast"
      />
    </>
  );
};

export default WalletsList;

const styles = StyleSheet.create({
  // WalletsList's own gutters: ContactRow carries no margin of its own.
  contactCard: { marginHorizontal: 16, marginBottom: 12 },
  sectionListContent: {
    flexGrow: 1,
  },
  listHeaderBack: {
    flexDirection: 'column',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  walletSection: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  balanceHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  balanceNumber: {
    fontSize: 48,
    lineHeight: 48,
    letterSpacing: -1.2,
    textAlign: 'center',
    fontFamily: ClashFont.medium,
    flexShrink: 1,
  },
  balanceUnit: {
    fontSize: 22,
    marginLeft: 10,
    fontFamily: ClashFont.regular,
  },
  balanceFiat: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 6,
    fontFamily: ClashFont.regular,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  actionBtnWide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 60,
    borderRadius: 16,
    borderWidth: 1,
  },
  actionBtnNoBorder: {
    borderWidth: 0,
  },
  actionBtnSquare: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnLabel: {
    fontSize: 15,
    fontFamily: ClashFont.medium,
  },
  trackPaymentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    height: 80,
    gap: 12,
    marginBottom: 12,
  },
  trackPaymentIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trackPaymentBannerContent: {
    flex: 1,
  },
  trackPaymentBannerTitle: {
    fontSize: 17,
    marginBottom: 3,
    fontFamily: ClashFont.medium,
  },
  trackPaymentBannerSubtitle: {
    fontSize: 13,
    fontFamily: ClashFont.regular,
  },
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  addContactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  addContactLabel: {
    fontSize: 16,
    lineHeight: 26,
    fontFamily: ClashFont.medium,
  },
  emptyCardOuter: {
    flex: 1,
  },
  shareAddressButton: {
    borderRadius: 16,
    height: 59,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareAddressText: {
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.31,
    textAlign: 'center',
    fontFamily: ClashFont.medium,
  },
});
