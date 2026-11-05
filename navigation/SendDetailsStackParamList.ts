import { Psbt } from 'bitcoinjs-lib';
import { CreateTransactionTarget, CreateTransactionUtxo } from '../class/wallets/types';
import { BitcoinUnit } from '../models/bitcoinUnits';
import { ScanQRCodeParamList } from './DetailViewStackParamList';
import { IFee } from '../screen/send/SendDetails';
import { NetworkTransactionFeeType } from '../models/networkTransactionFees';

export type SendDetailsParams = {
  transactionMemo?: string;
  isTransactionReplaceable?: boolean;
  feeUnit?: BitcoinUnit;
  frozenBalance?: number;
  amountUnit?: BitcoinUnit;
  address?: string;
  amount?: number;
  amountSats?: number;
  onBarScanned?: string;
  unit?: BitcoinUnit;
  noRbf?: boolean;
  walletID: string;
  launchedBy?: string;
  utxos?: CreateTransactionUtxo[] | null;
  isEditable?: boolean;
  uri?: string;
  selectedFeeRate?: string | undefined;
  selectedFeeType?: NetworkTransactionFeeType;
  addRecipientParams?: {
    address: string;
    amount?: number;
    memo?: string;
  };
};

export type SendDetailsStackParamList = {
  SendDetails: SendDetailsParams;
  SelectFee: {
    networkTransactionFees: {
      fastestFee: number;
      mediumFee: number;
      slowFee: number;
    };
    feePrecalc: IFee;
    feeRate: string;
    feeUnit?: BitcoinUnit;
    walletID: string;
    customFee?: string | null;
  };
  Confirm: {
    fee: number;
    memo?: string;
    walletID: string;
    tx: string;
    recipients: CreateTransactionTarget[];
    satoshiPerByte: number;
    // The address as entered/picked by the user, before wallet.createTransaction() may have
    // replaced it with a derived one-time silent-payment output address. Forwarded verbatim
    // to Success so "Save as a Contact" can validate the actual sp1... address, not the
    // one-time on-chain output.
    recipientAddress?: string;
    // Every payee as entered, before createTransaction() swaps silent payment addresses for their
    // one-time outputs. Shroud Chat tells those on chat about the payment.
    payees?: { address: string; value?: number }[];
  };
  PsbtWithHardwareWallet: {
    memo?: string;
    walletID: string;
    launchedBy?: string;
    psbt?: Psbt;
    txhex?: string;
  };
  CreateTransaction: {
    memo?: string;
    psbt?: Psbt;
    txhex?: string;
    tx: string;
    fee: number;
    showAnimatedQr?: boolean;
    recipients: CreateTransactionTarget[];
    satoshiPerByte: number;
    feeSatoshi?: number;
  };
  Success: {
    fee?: number;
    amount: number;
    amountUnit?: BitcoinUnit;
    txid?: string;
    recipientAddress?: string;
  };
  CoinControl: {
    walletID: string;
  };
  ScanQRCode: ScanQRCodeParamList;
};
