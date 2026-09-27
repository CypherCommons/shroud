import * as Electrum from '../../modules/Electrum';
import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import DefaultPreference from 'react-native-default-preference';
import { isReadClipboardAllowed, setReadClipboardAllowed } from '../../modules/clipboard';
import { getPreferredCurrency, GROUP_IO_SHROUD, initCurrencyDaemon, setPreferredCurrency } from '../../modules/currency';
import { ShroudApp } from '../../class';
import TorManager, { TorStatus } from '../../modules/torManager';
import {
  BLOCK_EXPLORERS,
  BlockExplorer,
  getBlockExplorerUrl,
  getBlockExplorersList,
  normalizeUrl,
  saveBlockExplorer,
} from '../../models/blockExplorer';

import { FiatUnit, TFiatUnit } from '../../models/fiatUnit';
import { useStorage } from '../../hooks/context/useStorage';
import { BitcoinUnit } from '../../models/bitcoinUnits';

const TotalWalletsBalanceKey = 'TotalWalletsBalance';
const TotalWalletsBalancePreferredUnit = 'TotalWalletsBalancePreferredUnit';
const ThemePreferenceKey = 'ThemePreference';
const PinLayoutScrambledKey = 'PinLayoutScrambled';

export type ThemePreference = 'system' | 'light' | 'dark';

const readPref = async <T,>(key: string, parse: (value: string | number | boolean | null) => T, fallback: T): Promise<T> => {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    return parse(await DefaultPreference.get(key));
  } catch (e) {
    console.error(`Error getting ${key}:`, e);
    return fallback;
  }
};

const writePref = async (key: string, value: string): Promise<void> => {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    await DefaultPreference.set(key, value);
  } catch (e) {
    console.error(`Error setting ${key}:`, e);
  }
};

const getThemePreferenceStorage = (): Promise<ThemePreference> =>
  readPref(ThemePreferenceKey, value => (value === 'light' || value === 'dark' || value === 'system' ? value : 'system'), 'system');

const persistThemePreference = (value: ThemePreference): Promise<void> => writePref(ThemePreferenceKey, value);

const getDoNotTrackStorage = (): Promise<boolean> => readPref(ShroudApp.DO_NOT_TRACK, value => value === '1', false);

const getIsTotalBalanceViewEnabled = (): Promise<boolean> => readPref(TotalWalletsBalanceKey, value => (value ?? 'true') === 'true', true);

const getTotalBalancePreferredUnit = (): Promise<BitcoinUnit> =>
  readPref(TotalWalletsBalancePreferredUnit, value => (value as BitcoinUnit | null) ?? BitcoinUnit.BTC, BitcoinUnit.BTC);

const persistTotalBalancePreferredUnit = (unit: BitcoinUnit): Promise<void> => writePref(TotalWalletsBalancePreferredUnit, unit);

const getIsPinLayoutScrambled = (): Promise<boolean> => readPref(PinLayoutScrambledKey, value => value === '1', false);

const persistIsPinLayoutScrambled = (value: boolean): Promise<void> => writePref(PinLayoutScrambledKey, value ? '1' : '0');

interface SettingsContextType {
  preferredFiatCurrency: TFiatUnit;
  setPreferredFiatCurrencyStorage: (currency: TFiatUnit) => Promise<void>;
  isScreenCaptureAllowed: boolean;
  setIsScreenCaptureAllowed: (value: boolean) => void;
  isDoNotTrackEnabled: boolean;
  isClipboardGetContentEnabled: boolean;
  setIsClipboardGetContentEnabledStorage: (value: boolean) => Promise<void>;
  isTotalBalanceEnabled: boolean;
  totalBalancePreferredUnit: BitcoinUnit;
  setTotalBalancePreferredUnitStorage: (unit: BitcoinUnit) => Promise<void>;
  themePreference: ThemePreference;
  setThemePreferenceStorage: (value: ThemePreference) => Promise<void>;
  settingsLoaded: boolean;
  isTorEnabled: boolean;
  setIsTorEnabled: (value: boolean) => Promise<void>;
  isTorOnly: boolean;
  setIsTorOnly: (value: boolean) => Promise<void>;
  torSocksPort: number;
  setTorSocksPort: (port: number) => Promise<boolean>;
  torStatus: TorStatus;
  checkTorConnection: () => Promise<boolean>;
  selectedBlockExplorer: BlockExplorer;
  setBlockExplorerStorage: (explorer: BlockExplorer) => Promise<boolean>;
  isPinLayoutScrambled: boolean;
  setIsPinLayoutScrambledStorage: (value: boolean) => Promise<void>;
}

const defaultSettingsContext: SettingsContextType = {
  preferredFiatCurrency: FiatUnit.USD,
  setPreferredFiatCurrencyStorage: async () => {},
  isScreenCaptureAllowed: false,
  setIsScreenCaptureAllowed: () => {},
  isDoNotTrackEnabled: false,
  isClipboardGetContentEnabled: true,
  setIsClipboardGetContentEnabledStorage: async () => {},
  isTotalBalanceEnabled: true,
  totalBalancePreferredUnit: BitcoinUnit.BTC,
  setTotalBalancePreferredUnitStorage: async () => {},
  themePreference: 'system',
  setThemePreferenceStorage: async () => {},
  settingsLoaded: false,
  isTorEnabled: false,
  setIsTorEnabled: async () => {},
  isTorOnly: false,
  setIsTorOnly: async () => {},
  torSocksPort: 9050,
  setTorSocksPort: async () => false,
  torStatus: 'disabled',
  checkTorConnection: async () => false,
  selectedBlockExplorer: BLOCK_EXPLORERS.default,
  setBlockExplorerStorage: async () => false,
  isPinLayoutScrambled: false,
  setIsPinLayoutScrambledStorage: async () => {},
};

export const SettingsContext = createContext<SettingsContextType>(defaultSettingsContext);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = React.memo(({ children }: { children: React.ReactNode }) => {
  const [preferredFiatCurrency, setPreferredFiatCurrencyState] = useState<TFiatUnit>(FiatUnit.USD);
  // Intentionally not persisted: screen-capture protection always resets to enabled (capture disallowed) on relaunch.
  const [isScreenCaptureAllowed, setIsScreenCaptureAllowed] = useState<boolean>(false);
  const [isDoNotTrackEnabled, setIsDoNotTrackEnabled] = useState<boolean>(false);
  const [isClipboardGetContentEnabled, setIsClipboardGetContentEnabled] = useState<boolean>(true);
  const [isTotalBalanceEnabled, setIsTotalBalanceEnabled] = useState<boolean>(true);
  const [totalBalancePreferredUnit, setTotalBalancePreferredUnit] = useState<BitcoinUnit>(BitcoinUnit.BTC);
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [settingsLoaded, setSettingsLoaded] = useState<boolean>(false);
  const [isTorEnabled, setIsTorEnabledState] = useState<boolean>(false);
  const [isTorOnly, setIsTorOnlyState] = useState<boolean>(false);
  const [torSocksPort, setTorSocksPortState] = useState<number>(9050);
  const [torStatus, setTorStatus] = useState<TorStatus>('disabled');
  const [selectedBlockExplorer, setSelectedBlockExplorer] = useState<BlockExplorer>(BLOCK_EXPLORERS.default);
  const [isPinLayoutScrambled, setIsPinLayoutScrambled] = useState<boolean>(false);

  const { walletsInitialized } = useStorage();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        await DefaultPreference.setName(GROUP_IO_SHROUD);
      } catch (e) {
        console.error('Error setting preference name:', e);
      }

      const promises: Promise<void>[] = [
        isReadClipboardAllowed().then(clipboardEnabled => {
          setIsClipboardGetContentEnabled(clipboardEnabled);
        }),
        getDoNotTrackStorage().then(doNotTrack => {
          setIsDoNotTrackEnabled(doNotTrack);
        }),
        getIsTotalBalanceViewEnabled().then(totalBalanceEnabled => {
          setIsTotalBalanceEnabled(totalBalanceEnabled);
        }),
        getTotalBalancePreferredUnit().then(preferredUnit => {
          setTotalBalancePreferredUnit(preferredUnit);
        }),
        getThemePreferenceStorage().then(preference => {
          setThemePreference(preference);
        }),
        TorManager.getInstance()
          .ensureLoaded()
          .then(() => {
            const settings = TorManager.getInstance().settings;
            setIsTorEnabledState(settings.enabled);
            setIsTorOnlyState(settings.torOnly);
            setTorSocksPortState(settings.socksPort);
            setTorStatus(TorManager.getInstance().status);
          }),
        getBlockExplorerUrl().then(url => {
          const found = getBlockExplorersList().find(explorer => normalizeUrl(explorer.url) === normalizeUrl(url));
          setSelectedBlockExplorer(found ?? BLOCK_EXPLORERS.default);
        }),
        getIsPinLayoutScrambled().then(scrambled => {
          setIsPinLayoutScrambled(scrambled);
        }),
      ];

      const results = await Promise.allSettled(promises);

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Error loading setting ${index}:`, result.reason);
        }
      });

      setSettingsLoaded(true);
    };

    loadSettings();
  }, []);

  useEffect(() => {
    initCurrencyDaemon()
      .then(getPreferredCurrency)
      .then(currency => {
        console.debug('SettingsContext currency:', currency);
        setPreferredFiatCurrencyState(currency as TFiatUnit);
      })
      .catch(e => {
        console.error('Error initializing currency daemon or getting preferred currency:', e);
      });
  }, []);

  useEffect(() => {
    if (walletsInitialized) {
      Electrum.connectMain();
    }
  }, [walletsInitialized]);

  useEffect(() => {
    const unsubscribe = TorManager.getInstance().addStatusListener(setTorStatus);
    return unsubscribe;
  }, []);

  const setPreferredFiatCurrencyStorage = useCallback(async (currency: TFiatUnit): Promise<void> => {
    try {
      await setPreferredCurrency(currency);
      setPreferredFiatCurrencyState(currency);
    } catch (e) {
      console.error('Error setting preferredFiatCurrency:', e);
    }
  }, []);

  const setTotalBalancePreferredUnitStorage = useCallback(async (unit: BitcoinUnit): Promise<void> => {
    try {
      await persistTotalBalancePreferredUnit(unit);
      setTotalBalancePreferredUnit(unit);
    } catch (e) {
      console.error('Error setting totalBalancePreferredUnit:', e);
    }
  }, []);

  const setIsClipboardGetContentEnabledStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      await setReadClipboardAllowed(value);
      setIsClipboardGetContentEnabled(value);
    } catch (e) {
      console.error('Error setting isClipboardGetContentEnabled:', e);
    }
  }, []);

  const setThemePreferenceStorage = useCallback(async (value: ThemePreference): Promise<void> => {
    try {
      await persistThemePreference(value);
      setThemePreference(value);
    } catch (e) {
      console.error('Error setting themePreference:', e);
    }
  }, []);

  const setIsTorEnabled = useCallback(async (value: boolean): Promise<void> => {
    try {
      await TorManager.getInstance().setEnabled(value);
      setIsTorEnabledState(value);
      if (!value) setIsTorOnlyState(false);
      setTorStatus(TorManager.getInstance().status);
    } catch (e) {
      console.error('Error setting isTorEnabled:', e);
    }
  }, []);

  const setIsTorOnly = useCallback(async (value: boolean): Promise<void> => {
    try {
      await TorManager.getInstance().setTorOnly(value);
      setIsTorOnlyState(value);
    } catch (e) {
      console.error('Error setting isTorOnly:', e);
    }
  }, []);

  const setTorSocksPort = useCallback(async (port: number): Promise<boolean> => {
    try {
      await TorManager.getInstance().setSocksPort(port);
      setTorSocksPortState(port);
      setTorStatus(TorManager.getInstance().status);
      return true;
    } catch (e) {
      console.error('Error setting torSocksPort:', e);
      return false;
    }
  }, []);

  const checkTorConnection = useCallback(async (): Promise<boolean> => {
    try {
      const result = await TorManager.getInstance().checkConnection();
      setTorStatus(TorManager.getInstance().status);
      return result;
    } catch (e) {
      console.error('Error checking Tor connection:', e);
      return false;
    }
  }, []);

  const setBlockExplorerStorage = useCallback(async (explorer: BlockExplorer): Promise<boolean> => {
    const success = await saveBlockExplorer(explorer.url);
    if (success) setSelectedBlockExplorer(explorer);
    return success;
  }, []);

  const setIsPinLayoutScrambledStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      await persistIsPinLayoutScrambled(value);
      setIsPinLayoutScrambled(value);
    } catch (e) {
      console.error('Error setting isPinLayoutScrambled:', e);
    }
  }, []);

  const value = useMemo(
    () => ({
      preferredFiatCurrency,
      setPreferredFiatCurrencyStorage,
      isScreenCaptureAllowed,
      setIsScreenCaptureAllowed,
      isDoNotTrackEnabled,
      isClipboardGetContentEnabled,
      setIsClipboardGetContentEnabledStorage,
      isTotalBalanceEnabled,
      totalBalancePreferredUnit,
      setTotalBalancePreferredUnitStorage,
      themePreference,
      setThemePreferenceStorage,
      settingsLoaded,
      isTorEnabled,
      setIsTorEnabled,
      isTorOnly,
      setIsTorOnly,
      torSocksPort,
      setTorSocksPort,
      torStatus,
      checkTorConnection,
      selectedBlockExplorer,
      setBlockExplorerStorage,
      isPinLayoutScrambled,
      setIsPinLayoutScrambledStorage,
    }),
    [
      preferredFiatCurrency,
      setPreferredFiatCurrencyStorage,
      isScreenCaptureAllowed,
      isDoNotTrackEnabled,
      isClipboardGetContentEnabled,
      setIsClipboardGetContentEnabledStorage,
      isTotalBalanceEnabled,
      totalBalancePreferredUnit,
      setTotalBalancePreferredUnitStorage,
      themePreference,
      setThemePreferenceStorage,
      settingsLoaded,
      isTorEnabled,
      setIsTorEnabled,
      isTorOnly,
      setIsTorOnly,
      torSocksPort,
      setTorSocksPort,
      torStatus,
      checkTorConnection,
      selectedBlockExplorer,
      setBlockExplorerStorage,
      isPinLayoutScrambled,
      setIsPinLayoutScrambledStorage,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
});
