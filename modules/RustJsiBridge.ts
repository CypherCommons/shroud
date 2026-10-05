import { Platform } from 'react-native';

import NativeRustJsiBridge from './specs/NativeRustJsiBridge';

const LINKING_ERROR =
  `The 'RustJsiBridge' module is not properly linked. ` +
  `Please ensure you've rebuilt the app after adding the native module.\n\n` +
  Platform.select({
    ios: "- Run 'cd ios && pod install && cd ..'\n",
    android: '- Ensure CMakeLists.txt is properly configured\n',
    default: '',
  }) +
  `- Rebuild the app (npx expo run:ios or run:android)`;

export interface RustMatchedUTXO {
  txid: string;
  vout: number;
  value: number;
  height: number;
  pubKey: string;
  tweakHex: string;
  blockHash: string;
  blockTime: number;
  isSpent: boolean;
}

export interface RustBatchScanResult {
  matchedUtxos: RustMatchedUTXO[];
  transactionsScanned: number;
  outputsScanned: number;
}

interface RustErrorResult {
  error: string;
}

interface RustJsiBridgeGlobal {
  spScanTransactions: (scanPrivkeyHex: string, spendPubkeysHex: string, transactionsJson: string) => string;
  spScanSingleTransaction: (scanPrivkeyHex: string, spendPubkeysHex: string, transactionJson: string) => string;
}

/** The native side parses the spend pubkeys as a comma-separated list of compressed hex keys. */
const encodeSpendPubkeys = (spendPubkeysHex: string[]): string => {
  if (spendPubkeysHex.length === 0) {
    throw new Error('At least one spend pubkey is required');
  }
  return spendPubkeysHex.join(',');
};

let isInstalled = false;

export function initializeRustJsiBridge(): boolean {
  if (isInstalled) {
    return true;
  }

  try {
    if (!NativeRustJsiBridge) {
      throw new Error(LINKING_ERROR);
    }
    // Loading the TurboModule is what installs the JSI functions, so confirm they actually exist.
    const result = NativeRustJsiBridge.install() && typeof getGlobal().spScanTransactions === 'function';
    if (result) {
      isInstalled = true;
      console.log('✅ Rust JSI Bridge installed successfully');
    }
    return result;
  } catch (error) {
    console.error('❌ Failed to install Rust JSI Bridge:', error);
    return false;
  }
}

// Type-safe wrappers for JSI functions
const getGlobal = (): RustJsiBridgeGlobal => {
  return global as any as RustJsiBridgeGlobal;
};

export function spScanTransactions<
  T extends {
    id: string;
    blockHeight: number;
    blockHash: string;
    blockTime: number;
    scanTweak: string;
    outputs: Array<{ transactionId: string; vout: number; pubKey: string; value: number; isSpent: boolean | number }>;
  },
>(scanPrivkeyHex: string, spendPubkeysHex: string[], transactions: T[]): RustBatchScanResult {
  if (!isInstalled) {
    throw new Error('RustJsiBridge not installed. Call initializeRustJsiBridge() first.');
  }

  const transactionsJson = JSON.stringify(transactions);
  const resultJson = getGlobal().spScanTransactions(scanPrivkeyHex, encodeSpendPubkeys(spendPubkeysHex), transactionsJson);
  const result: RustBatchScanResult | RustErrorResult = JSON.parse(resultJson);

  if ('error' in result) {
    throw new Error(`Rust scan error: ${result.error}`);
  }

  return result;
}

export function spScanSingleTransaction<
  T extends {
    id: string;
    blockHeight: number;
    blockHash: string;
    blockTime: number;
    scanTweak: string;
    outputs: Array<{ transactionId: string; vout: number; pubKey: string; value: number; isSpent: boolean | number }>;
  },
>(scanPrivkeyHex: string, spendPubkeysHex: string[], transaction: T): RustMatchedUTXO[] {
  if (!isInstalled) {
    throw new Error('RustJsiBridge not installed. Call initializeRustJsiBridge() first.');
  }

  const transactionJson = JSON.stringify(transaction);
  const resultJson = getGlobal().spScanSingleTransaction(scanPrivkeyHex, encodeSpendPubkeys(spendPubkeysHex), transactionJson);
  const result: RustMatchedUTXO[] | RustErrorResult = JSON.parse(resultJson);

  if ('error' in result) {
    throw new Error(`Rust scan error: ${(result as RustErrorResult).error}`);
  }

  return result as RustMatchedUTXO[];
}
