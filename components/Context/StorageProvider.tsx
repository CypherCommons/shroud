import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import A from '../../modules/analytics';
import { ShroudApp, TTXMetadata } from '../../class';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import type { TWallet } from '../../class/wallets/types';
import presentAlert from '../../components/Alert';
import loc from '../../loc';
import * as Electrum from '../../modules/Electrum';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { startAndDecrypt } from '../../modules/start-and-decrypt';
import { navigationRef } from '../../NavigationService';
import { type ScanStateInfo, IDLE_SCAN_STATE, isScannable } from '../../helpers/silent-payments';
import { clearPin } from '../../helpers/pinLock';

const shroudApp = ShroudApp.getInstance();

// hashmap of timestamps we _started_ refetching some wallet
const _lastTimeTriedToRefetchWallet: { [walletID: string]: number } = {};

interface StorageContextType {
  wallets: TWallet[];
  txMetadata: TTXMetadata;
  saveToDisk: (force?: boolean) => Promise<void>;
  selectedWalletID: () => string | undefined; // Change from string|undefined to a function
  addWallet: (wallet: TWallet) => boolean;
  deleteWallet: (wallet: TWallet) => void;
  // Rejects with a user-facing message when the wallet can't be added.
  addAndSaveWallet: (wallet: TWallet) => Promise<void>;
  fetchAndSaveWalletTransactions: (walletID: string) => Promise<void>;
  walletsInitialized: boolean;
  setWalletsInitialized: (initialized: boolean) => void;
  refreshAllWalletTransactions: (lastSnappedTo?: number, showUpdateStatusIndicator?: boolean) => Promise<void>;
  resetWallets: () => void;
  wipeDevice: () => Promise<void>;
  walletTransactionUpdateStatus: WalletTransactionsStatus | string;
  setWalletTransactionUpdateStatus: (status: WalletTransactionsStatus | string) => void;
  getTransactions: typeof shroudApp.getTransactions;
  fetchWalletBalances: typeof shroudApp.fetchWalletBalances;
  fetchWalletTransactions: typeof shroudApp.fetchWalletTransactions;
  getBalance: typeof shroudApp.getBalance;
  isStorageEncrypted: typeof shroudApp.storageIsEncrypted;
  startAndDecrypt: typeof startAndDecrypt;
  encryptStorage: typeof shroudApp.encryptStorage;
  exportEncryptedBackup: typeof shroudApp.exportEncryptedBackup;
  sleep: typeof shroudApp.sleep;
  createFakeStorage: typeof shroudApp.createFakeStorage;
  decryptStorage: typeof shroudApp.decryptStorage;
  isPasswordInUse: typeof shroudApp.isPasswordInUse;
  cachedPassword: typeof shroudApp.cachedPassword;
  getItem: typeof shroudApp.getItem;
  setItem: typeof shroudApp.setItem;
  handleWalletDeletion: (walletID: string) => Promise<boolean>;
  scanState: ScanStateInfo;
}

export enum WalletTransactionsStatus {
  NONE = 'NONE',
  ALL = 'ALL',
}

// @ts-ignore default value does not match the type
export const StorageContext = createContext<StorageContextType>(undefined);

export const StorageProvider = ({ children }: { children: React.ReactNode }) => {
  const txMetadata = useRef<TTXMetadata>(shroudApp.tx_metadata);

  const [wallets, setWallets] = useState<TWallet[]>([]);
  const [walletTransactionUpdateStatus, setWalletTransactionUpdateStatus] = useState<WalletTransactionsStatus | string>(
    WalletTransactionsStatus.NONE,
  );
  const [walletsInitialized, setWalletsInitialized] = useState<boolean>(false);
  const [scanState, setScanState] = useState<ScanStateInfo>(IDLE_SCAN_STATE);

  const selectedWalletID = useCallback((): string | undefined => {
    if (!navigationRef.current || !navigationRef.current.isReady()) return undefined;

    const screensToCheck = ['SendDetails', 'TransactionStatus'];

    const currentRoute = navigationRef.current.getCurrentRoute();
    console.debug('[StorageProvider] Current route:', currentRoute?.name);

    if (currentRoute) {
      if (screensToCheck.includes(currentRoute.name) && currentRoute.params) {
        const params = currentRoute.params as { walletID?: string };
        if (params.walletID) {
          console.debug('[StorageProvider] selectedWalletID from current route:', params.walletID);
          return params.walletID;
        }
      }
    }

    const state = navigationRef.current.getState();

    if (state?.routes) {
      for (const screenName of screensToCheck) {
        const walletID = findWalletIDInNavigationState(state.routes, screenName);
        if (walletID) {
          console.debug('[StorageProvider] selectedWalletID from navigation state:', walletID, 'in screen:', screenName);
          return walletID;
        }
      }

      const drawerRoute = state.routes.find((route: any) => route.name === 'DrawerRoot');
      if (drawerRoute?.state?.routes) {
        const detailViewStack = (drawerRoute.state.routes as any[]).find((route: any) => route.name === 'DetailViewStackScreensStack');
        if (detailViewStack?.state?.routes) {
          for (const route of detailViewStack.state.routes) {
            if (screensToCheck.includes(route.name) && (route.params as { walletID?: string })?.walletID) {
              console.debug(
                '[StorageProvider] selectedWalletID from drawer navigation:',
                (route.params as { walletID?: string })?.walletID,
              );
              return (route.params as { walletID?: string })?.walletID;
            }
          }
        }
      }
    }

    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findWalletIDInNavigationState = (routes: any[], screenName: string): string | undefined => {
    for (let i = routes.length - 1; i >= 0; i--) {
      const route = routes[i];

      if (route.name === screenName && (route.params as { walletID?: string }).walletID) {
        return (route.params as { walletID?: string }).walletID;
      }

      if (route.state?.routes) {
        const walletID = findWalletIDInNavigationState(route.state.routes, screenName);
        if (walletID) return walletID;
      }

      if (route.params?.screen === screenName && route.params?.params?.walletID) {
        return route.params.params.walletID;
      }

      if (route.name === 'DetailViewStackScreensStack' && route.params?.screen === screenName && route.params?.params?.walletID) {
        return route.params.params.walletID;
      }
    }

    return undefined;
  };

  const saveToDisk = useCallback(
    async (force: boolean = false) => {
      if (!force && shroudApp.getWallets().length === 0) {
        console.debug('Not saving empty wallets array');
        return;
      }
      await InteractionManager.runAfterInteractions(async () => {
        shroudApp.tx_metadata = txMetadata.current;
        await shroudApp.saveToDisk();
        const w: TWallet[] = [...shroudApp.getWallets()];
        setWallets(w);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txMetadata.current],
  );

  const forceWalletsUpdate = useCallback(() => {
    setWallets([...shroudApp.getWallets()]);
  }, []);

  // Debounced persist to avoid excessive saves during rapid scans
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedPersist = useCallback(() => {
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(() => saveToDisk(), 2000);
  }, [saveToDisk]);

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    };
  }, []);

  const addWallet = useCallback(
    (wallet: TWallet): boolean => {
      if (shroudApp.wallets.length > 0) {
        console.warn('[StorageProvider] Single-wallet mode: refusing to add a second wallet');
        return false;
      }

      if ('setOnBalanceChangeCallback' in wallet && typeof wallet.setOnBalanceChangeCallback === 'function') {
        wallet.setOnBalanceChangeCallback(forceWalletsUpdate);
      }
      if ('setOnPersistCallback' in wallet && typeof wallet.setOnPersistCallback === 'function') {
        wallet.setOnPersistCallback(debouncedPersist);
      }
      // NOTE: there is a single shared `scanState`. This assumes at most one scannable
      // (silent-payments) wallet is active at a time; multiple would clobber each other here.
      if (isScannable(wallet)) {
        wallet.setOnScanStateChangeCallback(setScanState);
        setScanState(wallet.getScanState());
      }

      shroudApp.wallets.push(wallet);
      setWallets([...shroudApp.getWallets()]);
      return true;
    },
    [forceWalletsUpdate, debouncedPersist],
  );

  const deleteWallet = useCallback((wallet: TWallet) => {
    if (isScannable(wallet)) {
      console.log('[StorageProvider] Cancelling active scan for wallet before deletion...');
      wallet.cancelScan();
    }

    if ('clearCache' in wallet && typeof wallet.clearCache === 'function') wallet.clearCache();

    shroudApp.deleteWallet(wallet);
    setWallets([...shroudApp.getWallets()]);
    setScanState(IDLE_SCAN_STATE);
  }, []);

  const handleWalletDeletion = useCallback(
    async (walletID: string): Promise<boolean> => {
      console.debug(`handleWalletDeletion: invoked for walletID ${walletID}`);
      const wallet = wallets.find(w => w.getID() === walletID);
      if (!wallet) {
        console.warn(`handleWalletDeletion: wallet not found for ${walletID}`);
        return false;
      }

      try {
        deleteWallet(wallet);
        console.debug(`handleWalletDeletion: wallet ${walletID} deleted successfully`);
        await saveToDisk(true);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        return true;
      } catch (e: unknown) {
        console.error(`handleWalletDeletion: encountered error for wallet ${walletID}`, e);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        return await new Promise<boolean>(resolve => {
          presentAlert({
            title: loc.errors.error,
            message: loc.wallets.details_delete_wallet_error_message,
            buttons: [
              {
                text: loc.wallets.details_delete_anyway,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID);
                  resolve(result);
                },
                style: 'destructive',
              },
              {
                text: loc.wallets.list_tryagain,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID);
                  resolve(result);
                },
              },
              {
                text: loc._.cancel,
                onPress: () => resolve(false),
                style: 'cancel',
              },
            ],
            options: { cancelable: false },
          });
        });
      }
    },
    [deleteWallet, saveToDisk, wallets],
  );

  const resetWallets = useCallback(() => {
    setWallets(shroudApp.getWallets());
  }, []);

  // Forgot-PIN reset: wipes the wallet data and the PIN. txMetadata is cleared too, since saveToDisk()
  // copies it back into the singleton on every save.
  const wipeDevice = useCallback(async () => {
    await shroudApp.wipeAllData();
    await clearPin();
    txMetadata.current = {};
    setWallets([]);
  }, []);

  // Initialize wallets
  useEffect(() => {
    if (walletsInitialized) {
      txMetadata.current = shroudApp.tx_metadata;
      const currentWallets = shroudApp.getWallets();

      currentWallets.forEach(wallet => {
        if ('setOnBalanceChangeCallback' in wallet && typeof wallet.setOnBalanceChangeCallback === 'function') {
          wallet.setOnBalanceChangeCallback(forceWalletsUpdate);
        }
        if ('setOnPersistCallback' in wallet && typeof wallet.setOnPersistCallback === 'function') {
          wallet.setOnPersistCallback(debouncedPersist);
        }
        if (isScannable(wallet)) {
          wallet.setOnScanStateChangeCallback(setScanState);
          setScanState(wallet.getScanState());
        }
      });

      setWallets(currentWallets);
    }
  }, [walletsInitialized, forceWalletsUpdate, debouncedPersist]);

  // Add a refresh lock to prevent concurrent refreshes
  const refreshingRef = useRef<boolean>(false);

  const refreshAllWalletTransactions = useCallback(
    async (lastSnappedTo?: number, showUpdateStatusIndicator: boolean = true) => {
      if (refreshingRef.current) {
        console.debug('[refreshAllWalletTransactions] Refresh already in progress');
        return;
      }
      console.debug('[refreshAllWalletTransactions] Starting refresh');
      refreshingRef.current = true;

      await new Promise<void>(resolve => InteractionManager.runAfterInteractions(() => resolve()));

      const TIMEOUT_DURATION = 30000;
      let refreshTimeout;
      const timeoutPromise = new Promise<never>(
        (_resolve, reject) =>
          (refreshTimeout = setTimeout(() => {
            console.debug('[refreshAllWalletTransactions] Timeout reached');
            reject(new Error('Timeout reached'));
          }, TIMEOUT_DURATION)),
      );

      try {
        if (showUpdateStatusIndicator) {
          console.debug('[refreshAllWalletTransactions] Setting wallet transaction status to ALL');
          setWalletTransactionUpdateStatus(WalletTransactionsStatus.ALL);
        }
        console.debug('[refreshAllWalletTransactions] Waiting for connectivity...');
        await Electrum.waitTillConnected();
        if (!(await Electrum.ping())) {
          // above `waitTillConnected` is not reliable, as app might have returned from long sleep, so it thinks its
          // connected but actually socket is closed. thus, we ping, and if it fails - we wait again (reconnection code
          // should pick up)
          console.log('[refreshAllWalletTransactions] ping failed, waiting for connection...');
          await Electrum.waitTillConnected();
        }

        console.debug('[refreshAllWalletTransactions] Connected to Electrum');

        console.debug('[refreshAllWalletTransactions] Fetching wallet balances and transactions');
        await Promise.race([
          (async () => {
            const balanceStart = Date.now();
            await shroudApp.fetchWalletBalances(lastSnappedTo);
            const balanceEnd = Date.now();
            console.debug('[refreshAllWalletTransactions] fetch balance took', (balanceEnd - balanceStart) / 1000, 'sec');

            const txStart = Date.now();
            await shroudApp.fetchWalletTransactions(lastSnappedTo);
            const txEnd = Date.now();
            console.debug('[refreshAllWalletTransactions] fetch tx took', (txEnd - txStart) / 1000, 'sec');

            clearTimeout(refreshTimeout);

            console.debug('[refreshAllWalletTransactions] Saving data to disk');
            await saveToDisk();
          })(),
          timeoutPromise,
        ]);
        console.debug('[refreshAllWalletTransactions] Refresh completed successfully');
      } catch (error) {
        console.error('[refreshAllWalletTransactions] Error:', error);
      } finally {
        console.debug('[refreshAllWalletTransactions] Resetting wallet transaction status and refresh lock');
        setWalletTransactionUpdateStatus(WalletTransactionsStatus.NONE);
        refreshingRef.current = false;
      }
    },
    [saveToDisk],
  );

  const fetchAndSaveWalletTransactions = useCallback(
    async (walletID: string) => {
      await InteractionManager.runAfterInteractions(async () => {
        const index = wallets.findIndex(wallet => wallet.getID() === walletID);
        let noErr = true;
        try {
          if (Date.now() - (_lastTimeTriedToRefetchWallet[walletID] || 0) < 5000) {
            console.debug('[fetchAndSaveWalletTransactions] Re-fetch wallet happens too fast; NOP');
            return;
          }
          _lastTimeTriedToRefetchWallet[walletID] = Date.now();

          await Electrum.waitTillConnected();
          setWalletTransactionUpdateStatus(walletID);

          const balanceStart = Date.now();
          await shroudApp.fetchWalletBalances(index);
          const balanceEnd = Date.now();
          console.debug('[fetchAndSaveWalletTransactions] fetch balance took', (balanceEnd - balanceStart) / 1000, 'sec');

          const txStart = Date.now();
          await shroudApp.fetchWalletTransactions(index);
          const txEnd = Date.now();
          console.debug('[fetchAndSaveWalletTransactions] fetch tx took', (txEnd - txStart) / 1000, 'sec');
        } catch (err) {
          noErr = false;
          console.error('[fetchAndSaveWalletTransactions] Error:', err);
        } finally {
          setWalletTransactionUpdateStatus(WalletTransactionsStatus.NONE);
        }
        if (noErr) await saveToDisk();
      });
    },
    [saveToDisk, wallets],
  );

  const addAndSaveWallet = useCallback(
    async (w: TWallet) => {
      if (wallets.length > 0) throw new Error(loc.wallets.single_wallet_limit);
      const emptyWalletLabel = new HDSilentPaymentsWallet().getLabel();
      if (w.getLabel() === emptyWalletLabel) w.setLabel(loc.wallets.import_imported + ' ' + w.typeReadable);
      w.setUserHasSavedExport(true);
      if (!addWallet(w)) throw new Error(loc.wallets.single_wallet_limit);
      await saveToDisk();
      A(A.ENUM.CREATED_WALLET);

      // Resolves once the wallet is on disk; balance and scan catch up in the background.
      (async () => {
        await w.fetchBalance();
        if (isScannable(w) && !w.isScanActive()) await w.fetchTransactions();
      })().catch((e: any) => console.warn('[addAndSaveWallet] sync error:', e));
    },
    [wallets, addWallet, saveToDisk],
  );

  const value: StorageContextType = useMemo(
    () => ({
      wallets,
      txMetadata: txMetadata.current,
      saveToDisk,
      getTransactions: shroudApp.getTransactions,
      selectedWalletID,
      addWallet,
      deleteWallet,
      addAndSaveWallet,
      setItem: shroudApp.setItem,
      getItem: shroudApp.getItem,
      fetchWalletBalances: shroudApp.fetchWalletBalances,
      fetchWalletTransactions: shroudApp.fetchWalletTransactions,
      fetchAndSaveWalletTransactions,
      isStorageEncrypted: shroudApp.storageIsEncrypted,
      encryptStorage: shroudApp.encryptStorage,
      exportEncryptedBackup: shroudApp.exportEncryptedBackup,
      startAndDecrypt,
      cachedPassword: shroudApp.cachedPassword,
      getBalance: shroudApp.getBalance,
      walletsInitialized,
      setWalletsInitialized,
      refreshAllWalletTransactions,
      sleep: shroudApp.sleep,
      createFakeStorage: shroudApp.createFakeStorage,
      resetWallets,
      wipeDevice,
      decryptStorage: shroudApp.decryptStorage,
      isPasswordInUse: shroudApp.isPasswordInUse,
      walletTransactionUpdateStatus,
      setWalletTransactionUpdateStatus,
      handleWalletDeletion,
      scanState,
    }),
    [
      wallets,
      saveToDisk,
      selectedWalletID,
      addWallet,
      deleteWallet,
      addAndSaveWallet,
      fetchAndSaveWalletTransactions,
      walletsInitialized,
      setWalletsInitialized,
      refreshAllWalletTransactions,
      resetWallets,
      wipeDevice,
      walletTransactionUpdateStatus,
      handleWalletDeletion,
      scanState,
    ],
  );

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
};
