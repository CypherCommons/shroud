import b58 from 'bs58check';
import { sha256 } from '@noble/hashes/sha256';

import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { DEFAULT_NETWORK_ID, getActiveNetworkId, getNetwork, isNetworkId, NetworkConfig, NetworkId } from '../../modules/network';
import { CreateTransactionResult, CreateTransactionUtxo, Transaction, Utxo } from './types';

type WalletWithPassphrase = AbstractWallet & { getPassphrase: () => string; passphraseFingerprint?: string };
type UtxoMetadata = {
  frozen?: boolean;
  memo?: string;
};

/**
 * Resolve the network of a wallet coming back out of storage. Wallets persisted before
 * multi-network support carry no `networkId`, and every one of those is mainnet — so absent or
 * unrecognised means mainnet, never "whatever is currently selected". Getting this wrong would
 * silently re-label an existing mainnet wallet as testnet on first load after a network switch.
 */
export function normaliseStoredNetworkId(value: unknown): NetworkId {
  return isNetworkId(value) ? value : DEFAULT_NETWORK_ID;
}

export class AbstractWallet {
  static readonly type = 'abstract';
  static readonly typeReadable = 'abstract';
  // @ts-ignore: override
  public readonly type = AbstractWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = AbstractWallet.typeReadable;

  static fromJson(obj: string): AbstractWallet {
    const obj2 = JSON.parse(obj);
    const temp = new this();
    // `new this()` stamped the wallet with whichever chain is selected right now. Pin it to the
    // stored one before anything else runs, so nothing below can inherit the ambient chain.
    temp.networkId = normaliseStoredNetworkId(obj2.networkId);
    for (const key2 of Object.keys(obj2)) {
      if (key2 === 'networkId') continue; // already resolved; the raw value may be unrecognised
      // @ts-ignore This kind of magic is not allowed in typescript, we should try and be more specific
      temp[key2] = obj2[key2];
    }
    // Anything the constructor defaulted from the ambient chain and the blob did not override has
    // to be recomputed for the stored one.
    if (obj2._derivationPath === undefined) temp.applyNetworkDefaults();

    return temp;
  }

  segwitType?: 'p2wpkh' | 'p2sh(p2wpkh)' | 'p2tr';
  _derivationPath?: string;
  label: string;
  secret: string;
  balance: number;
  unconfirmed_balance: number;
  _address: string | false;
  _utxo: Utxo[];
  _lastTxFetch: number;
  _lastBalanceFetch: number;
  preferredBalanceUnit: BitcoinUnit;
  chain: Chain;
  hideBalance: boolean;
  userHasSavedExport: boolean;
  _hideTransactionsInWalletsList: boolean;
  _utxoMetadata: Record<string, UtxoMetadata>;
  /**
   * Chain this wallet lives on. Serialized with the wallet (it is a plain own property, so
   * `Object.assign` in saveToDisk picks it up) and restored via `normaliseStoredNetworkId`.
   */
  networkId: NetworkId;

  constructor() {
    this.label = '';
    this.secret = ''; // private key or recovery phrase
    this.balance = 0;
    this.unconfirmed_balance = 0;
    this._address = false; // cache
    this._utxo = [];
    this._lastTxFetch = 0;
    this._lastBalanceFetch = 0;
    this.preferredBalanceUnit = BitcoinUnit.BTC;
    this.chain = Chain.ONCHAIN;
    this.hideBalance = false;
    this.userHasSavedExport = false;
    this._hideTransactionsInWalletsList = false;
    this._utxoMetadata = {};
    // A freshly constructed wallet belongs to whatever network is selected now. Deserialization
    // overwrites this from storage — see `normaliseStoredNetworkId`.
    this.networkId = getActiveNetworkId();
  }

  /**
   * (Re)compute defaults that depend on `networkId`. The constructor runs before deserialization
   * has restored the stored chain, so `fromJson` calls this again once it has.
   */
  protected applyNetworkDefaults(): void {}

  /** Full config (bitcoinjs network, coin type, backends) for the chain this wallet is on. */
  getNetworkConfig(): NetworkConfig {
    return getNetwork(this.networkId);
  }

  /**
   * @returns {number} Timestamp (millisecsec) of when last transactions were fetched from the network
   */
  getLastTxFetch(): number {
    return this._lastTxFetch;
  }

  getID(): string {
    const thisWithPassphrase = this as unknown as WalletWithPassphrase;
    // A passphrase wallet is identified by its fingerprint, not the passphrase itself: the ID is
    // stored next to the secret (Realm rows), and hashing the passphrase in would let anyone with
    // that storage test passphrase guesses with one SHA-256 each. Wallets without a passphrase have
    // no fingerprint and keep their original ID.
    const passphrase =
      thisWithPassphrase.passphraseFingerprint ?? (thisWithPassphrase.getPassphrase ? thisWithPassphrase.getPassphrase() : '');
    const path = this._derivationPath ?? '';
    // Mainnet contributes an empty suffix, so every ID minted before multi-network support is
    // byte-identical — existing Realm transaction rows and the stored selected-wallet id stay
    // valid, and no migration is needed. The suffix exists because testnet4 and signet share
    // coin type 1' and therefore the same derivation path: without it they hash to the same ID,
    // which makes loadFromDisk silently drop one of them and merges their tx histories in the
    // Realm cache (which is keyed on wallet id).
    const networkSuffix = this.networkId === DEFAULT_NETWORK_ID ? '' : this.networkId;
    const string2hash = this.type + this.getSecret() + passphrase + path + networkSuffix;
    return Buffer.from(sha256(string2hash)).toString('hex');
  }

  getTransactions(): Transaction[] {
    throw new Error('not implemented');
  }

  getUserHasSavedExport(): boolean {
    return this.userHasSavedExport;
  }

  setUserHasSavedExport(value: boolean): void {
    this.userHasSavedExport = value;
  }

  getHideTransactionsInWalletsList(): boolean {
    return this._hideTransactionsInWalletsList;
  }

  setHideTransactionsInWalletsList(value: boolean): void {
    this._hideTransactionsInWalletsList = value;
  }

  /**
   *
   * @returns {string}
   */
  getLabel(): string {
    if (this.label.trim().length === 0) {
      return 'Wallet';
    }
    return this.label;
  }

  getXpub(): string | false {
    return this._address;
  }

  /**
   *
   * @returns {number} Available to spend amount, int, in sats
   */
  getBalance(): number {
    return this.balance + (this.getUnconfirmedBalance() < 0 ? this.getUnconfirmedBalance() : 0);
  }

  getPreferredBalanceUnit(): BitcoinUnit {
    for (const value of Object.values(BitcoinUnit)) {
      if (value === this.preferredBalanceUnit) {
        return this.preferredBalanceUnit;
      }
    }
    return BitcoinUnit.BTC;
  }

  async allowOnchainAddress(): Promise<boolean> {
    throw new Error('allowOnchainAddress: Not implemented');
  }

  allowReceive(): boolean {
    return true;
  }

  allowSend(): boolean {
    return true;
  }

  allowSilentPaymentSend(): boolean {
    return false;
  }

  allowRBF(): boolean {
    return false;
  }

  allowCosignPsbt(): boolean {
    return false;
  }

  allowMasterFingerprint(): boolean {
    return false;
  }

  allowXpub(): boolean {
    return false;
  }

  weOwnAddress(address: string): boolean {
    throw Error('not implemented');
  }

  weOwnTransaction(txid: string): boolean {
    throw Error('not implemented');
  }

  /**
   * Returns delta of unconfirmed balance. For example, if theres no
   * unconfirmed balance its 0
   *
   * @return {number} Satoshis
   */
  getUnconfirmedBalance(): number {
    return this.unconfirmed_balance;
  }

  setLabel(newLabel: string): this {
    this.label = newLabel;
    return this;
  }

  getSecret(): string {
    return this.secret;
  }

  setSecret(newSecret: string): this {
    this.secret = newSecret;
    return this;
  }

  getLatestTransactionTime(): string | 0 {
    return 0;
  }

  /**
   * @deprecated
   * TODO: be more precise on the type
   */

  createTx(): any {
    throw Error('not implemented');
  }

  /**
   *
   * @param utxos {Array.<{vout: Number, value: Number, txid: String, address: String}>} List of spendable utxos
   * @param targets {Array.<{value: Number, address: String}>} Where coins are going. If theres only 1 target and that target has no value - this will send MAX to that address (respecting fee rate)
   * @param feeRate {Number} satoshi per byte
   * @param changeAddress {String} Excessive coins will go back to that address
   * @param sequence {Number} Used in RBF
   * @param skipSigning {boolean} Whether we should skip signing, use returned `psbt` in that case
   * @param masterFingerprint {number} Decimal number of wallet's master fingerprint
   * @returns {{outputs: Array, tx: Transaction, inputs: Array, fee: Number, psbt: Psbt}}
   */
  createTransaction(
    utxos: CreateTransactionUtxo[],
    targets: {
      address: string;
      value?: number;
    }[],
    feeRate: number,
    changeAddress: string,
    sequence: number,
    skipSigning = false,
    masterFingerprint: number,
  ): CreateTransactionResult {
    throw Error('not implemented');
  }

  getAddress(): string | false | undefined {
    throw Error('not implemented');
  }

  getAddressAsync(): Promise<string | false | undefined> {
    return new Promise(resolve => resolve(this.getAddress()));
  }

  async getChangeAddressAsync(): Promise<string | false | undefined> {
    return new Promise(resolve => resolve(this.getAddress()));
  }

  useWithHardwareWalletEnabled(): boolean {
    return false;
  }

  async wasEverUsed(): Promise<boolean> {
    throw new Error('Not implemented');
  }

  /**
   * Returns _all_ external addresses in hierarchy (for HD wallets) or just address for single-address wallets
   * _Not_ internal ones, as this method is supposed to be used for subscription of external notifications.
   *
   * @returns string[] Addresses
   */
  getAllExternalAddresses(): string[] {
    return [];
  }

  /*
   * Rewrites an extended public key to this network's standard BIP-32 public version — xpub on
   * mainnet, tpub on the test chains. Named for the zpub case it was written for, but it is
   * version-agnostic on input, so passing an already-normalised key through is a no-op. That
   * matters because taproot wallets hand it a plain xpub/tpub.
   *
   * @param {String} zpub
   * @returns {String} xpub (or tpub on the test chains)
   */
  _zpubToXpub(zpub: string): string {
    const version = Buffer.alloc(4);
    version.writeUInt32BE(this.getNetworkConfig().bitcoinjs.bip32.public);
    let data = b58.decode(zpub);
    data = data.slice(4);
    data = Buffer.concat([version, data]);

    return b58.encode(data);
  }

  prepareForSerialization(): void {}

  /*
   * Get metadata (frozen, memo) for a specific UTXO
   *
   * @param {String} txid - transaction id
   * @param {number} vout - an index number of the output in transaction
   */
  getUTXOMetadata(txid: string, vout: number): UtxoMetadata {
    return this._utxoMetadata[`${txid}:${vout}`] || {};
  }

  /*
   * Set metadata (frozen, memo) for a specific UTXO
   *
   * @param {String} txid - transaction id
   * @param {number} vout - an index number of the output in transaction
   * @param {{memo: String, frozen: Boolean}} opts - options to attach to UTXO
   */
  setUTXOMetadata(txid: string, vout: number, opts: UtxoMetadata): void {
    const meta = this._utxoMetadata[`${txid}:${vout}`] || {};
    if ('memo' in opts) meta.memo = opts.memo;
    if ('frozen' in opts) meta.frozen = opts.frozen;
    this._utxoMetadata[`${txid}:${vout}`] = meta;
  }

  isSegwit() {
    return false;
  }
}
