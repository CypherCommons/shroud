import * as bitcoin from 'bitcoinjs-lib';
import { CoinSelectOutput, CoinSelectReturnInput, CoinSelectUtxo } from 'coinselect';

import { BitcoinUnit } from '../../models/bitcoinUnits';
import type { HDSilentPaymentsWallet } from './hd-bip352-wallet.ts';

export type Utxo = {
  // Returned by Electrum
  height: number;
  address: string;
  txid: string;
  vout: number;
  value: number;

  // Others
  txhex?: string;
  confirmations?: number;
  wif?: string | false;
};

/**
 * same as coinselect.d.ts/CoinSelectUtxo
 */
export interface CreateTransactionUtxo extends CoinSelectUtxo {}

/**
 * if address is missing and `script.hex` is set - this is a custom script (like OP_RETURN)
 */
export type CreateTransactionTarget = {
  address?: string;
  value?: number;
  script?: {
    length?: number; // either length or hex should be present
    hex?: string;
  };
};

export type CreateTransactionResult = {
  tx?: bitcoin.Transaction;
  inputs: CoinSelectReturnInput[];
  outputs: CoinSelectOutput[];
  fee: number;
  psbt: bitcoin.Psbt;
};

type TransactionInput = {
  txid: string;
  vout: number;
  scriptSig: { asm: string; hex: string };
  txinwitness: string[];
  sequence: number;
  addresses?: string[];
  address?: string;
  value?: number;
};

type TransactionOutput = {
  value: number;
  n: number;
  scriptPubKey: {
    asm: string;
    hex: string;
    reqSigs: number;
    type: string;
    addresses: string[];
  };
};

export type Transaction = {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  blockhash: string;
  confirmations: number;
  time: number;
  blocktime: number;
  timestamp: number; // seconds, not milliseconds
  value?: number;
  /**
   * Set on a spend of our own coins that also pays one of our own addresses (not change): the
   * sats it paid us, and where. `value` nets that against the inputs, leaving only the fee, so
   * the list shows such a self-transfer as a send and a receive (see splitSelfTransfer).
   */
  selfTransfer?: { value: number; address?: string };
};

/**
 * in some cases we add additional data to each tx object so the code that works with that transaction can find the
 * wallet that owns it etc
 */
export type ExtendedTransaction = Transaction & {
  walletID: string;
  walletPreferredBalanceUnit: BitcoinUnit;
};

export type TWallet = HDSilentPaymentsWallet;
