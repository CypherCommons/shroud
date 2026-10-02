import { BIP32Interface } from 'bip32';
import * as bip39 from 'bip39';

import * as bip39custom from '../../modules/bip39';
import * as Electrum from '../../modules/Electrum';
import { AbstractWallet } from './abstract-wallet';
import { Transaction } from './types';

// Prefixes that uniquely identify one word in the default (English) wordlist. Lazily built
// and memoised on first use rather than eagerly at module load, since AbstractHDWallet is
// imported at app boot (via class/index.ts) regardless of whether setSecret is ever called.
let englishPrefixCompletions: Map<string, string> | undefined;
function getEnglishPrefixCompletions(): Map<string, string> {
  if (!englishPrefixCompletions) {
    const completions = new Map<string, string>();
    const ambiguousPrefixes = new Set<string>();

    for (const word of bip39.wordlists[bip39.getDefaultWordlist()]) {
      for (const prefix of [word.slice(0, 3), word.slice(0, 4)]) {
        if (ambiguousPrefixes.has(prefix)) continue;
        if (completions.has(prefix)) {
          completions.delete(prefix);
          ambiguousPrefixes.add(prefix);
        } else {
          completions.set(prefix, word);
        }
      }
    }

    englishPrefixCompletions = completions;
  }

  return englishPrefixCompletions;
}

// Strips visible ASCII punctuation plus Unicode whitespace/invisible separators (general
// punctuation block, C0/C1 controls, DEL), leaving wordlist characters (CJK, accented Latin,
// Hangul, etc.) untouched. Not \p{L}/\p{N} (Unicode property escapes): Hermes's regex engine
// has broken support for them (facebook/hermes#850, facebook/hermes#1027). Verified against
// all 10 supported wordlists: no wordlist character falls in the stripped ranges.
// eslint-disable-next-line no-control-regex -- \x00-\x1f/\x7f are intentionally stripped, not accidental
const MNEMONIC_SEPARATOR_PATTERN = /[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xa0\u2000-\u206f]/g;

function normalizeMnemonicInput(secret: string): string {
  return secret.trim().toLowerCase().replace(MNEMONIC_SEPARATOR_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

// Completes a partial English word only when it isn't already a complete word in some
// supported wordlist — otherwise a short word from another Latin-script wordlist (e.g.
// Spanish "luna") can collide with a unique English prefix and get silently rewritten
// (e.g. to "lunar"), even when only some other word in the phrase has a typo.
function completePartialWords(secret: string): string {
  const prefixCompletions = getEnglishPrefixCompletions();
  return secret
    .split(' ')
    .map(word => (bip39custom.ALL_WORDS.has(word) ? word : prefixCompletions.get(word) || word))
    .join(' ');
}

type AbstractHDWalletStatics = {
  /**
   * Account-level derivation path for this wallet type, as a function of the BIP-44 coin type so
   * the same class can derive on mainnet (0') and the test chains (1').
   */
  derivationPathForCoinType?: (coinType: number) => string;
};

/**
 * @deprecated
 */
export class AbstractHDWallet extends AbstractWallet {
  static readonly type = 'abstract';
  static readonly typeReadable = 'abstract';
  // @ts-ignore: override
  public readonly type = AbstractHDWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = AbstractHDWallet.typeReadable;

  next_free_address_index: number;
  next_free_change_address_index: number;
  internal_addresses_cache: Record<number, string>;
  external_addresses_cache: Record<number, string>;
  _xpub: string;
  usedAddresses: string[];
  _address_to_wif_cache: Record<string, string>;
  gap_limit: number;
  passphrase?: string;
  _node0?: BIP32Interface;
  _node1?: BIP32Interface;

  constructor() {
    super();
    this.next_free_address_index = 0;
    this.next_free_change_address_index = 0;
    this.internal_addresses_cache = {}; // index => address
    this.external_addresses_cache = {}; // index => address
    this._xpub = ''; // cache
    this.usedAddresses = [];
    this._address_to_wif_cache = {};
    this.gap_limit = 20;
    this.applyNetworkDefaults();
  }

  /**
   * `super()` has already set `networkId`, so the coin type is available here. On deserialization
   * a stored path overwrites this, which is what keeps wallets created before multi-network
   * support on their original derivation; a blob with no path gets the default for its *stored*
   * network, because `fromJson` calls this again after restoring `networkId`.
   */
  protected applyNetworkDefaults(): void {
    const Constructor = this.constructor as unknown as AbstractHDWalletStatics;
    this._derivationPath = Constructor.derivationPathForCoinType?.(this.getNetworkConfig().coinType);
  }

  getNextFreeAddressIndex(): number {
    return this.next_free_address_index;
  }

  getNextFreeChangeAddressIndex(): number {
    return this.next_free_change_address_index;
  }

  prepareForSerialization(): void {
    // deleting structures that cant be serialized
    delete this._node0;
    delete this._node1;
  }

  generate(): Promise<void> {
    throw new Error('Not implemented');
  }

  allowSend(): boolean {
    return false;
  }

  getTransactions(): Transaction[] {
    throw new Error('Not implemented');
  }

  /**
   * @return {Buffer} wallet seed
   */
  _getSeed(): Buffer {
    const mnemonic = this.secret;
    const passphrase = this.passphrase;
    return bip39.mnemonicToSeedSync(mnemonic, passphrase);
  }

  setSecret(newSecret: string): this {
    // first, checking if it's a SeedQR:
    try {
      // compact seedQR should be between 32 - 64 chars long in hex format
      if (newSecret.length === 64 || newSecret.length === 32) {
        // not supported as mobile scanners dont recognize such QRs at all.
        // nop
      } else if (newSecret.length === 96 || newSecret.length === 48) {
        // standard seedQR
        const wordlist = bip39.wordlists[bip39.getDefaultWordlist()];
        const words = newSecret.match(/[\d]{4}/g);

        if (words) {
          newSecret = words.map(num => wordlist[parseInt(num, 10)]).join(' ');
        }
      }
    } catch (e) {}
    // end SeedQR

    this.secret = completePartialWords(normalizeMnemonicInput(newSecret));

    return this;
  }

  setPassphrase(passphrase: string): void {
    this.passphrase = passphrase;
  }

  getPassphrase(): string | undefined {
    return this.passphrase;
  }

  /**
   * @return {Boolean} is mnemonic in `this.secret` valid
   */
  validateMnemonic(): boolean {
    return bip39custom.validateMnemonic(this.secret);
  }

  /**
   * Derives from hierarchy, returns next free address
   * (the one that has no transactions). Looks for several,
   * gives up if none found, and returns the used one
   *
   * @return {Promise.<string>}
   */
  async getAddressAsync(): Promise<string> {
    // looking for free external address
    let freeAddress = '';
    let c;
    for (c = 0; c < this.gap_limit + 1; c++) {
      if (this.next_free_address_index + c < 0) continue;
      const address = this._getExternalAddressByIndex(this.next_free_address_index + c);
      this.external_addresses_cache[this.next_free_address_index + c] = address; // updating cache just for any case
      let txs = [];
      try {
        txs = await Electrum.getTransactionsByAddress(address);
      } catch (Err: any) {
        console.warn('Electrum.getTransactionsByAddress()', Err.message);
      }
      if (txs.length === 0) {
        // found free address
        freeAddress = address;
        this.next_free_address_index += c; // now points to _this one_
        break;
      }
    }

    if (!freeAddress) {
      // could not find in cycle above, give up
      freeAddress = this._getExternalAddressByIndex(this.next_free_address_index + c); // we didnt check this one, maybe its free
      this.next_free_address_index += c; // now points to this one
    }
    this._address = freeAddress;
    return freeAddress;
  }

  /**
   * Derives from hierarchy, returns next free CHANGE address
   * (the one that has no transactions). Looks for several,
   * gives up if none found, and returns the used one
   *
   * @return {Promise.<string>}
   */
  async getChangeAddressAsync(): Promise<string> {
    // looking for free internal address
    let freeAddress = '';
    let c;
    for (c = 0; c < this.gap_limit + 1; c++) {
      if (this.next_free_change_address_index + c < 0) continue;
      const address = this._getInternalAddressByIndex(this.next_free_change_address_index + c);
      this.internal_addresses_cache[this.next_free_change_address_index + c] = address; // updating cache just for any case
      let txs = [];
      try {
        txs = await Electrum.getTransactionsByAddress(address);
      } catch (Err: any) {
        console.warn('Electrum.getTransactionsByAddress()', Err.message);
      }
      if (txs.length === 0) {
        // found free address
        freeAddress = address;
        this.next_free_change_address_index += c; // now points to _this one_
        break;
      }
    }

    if (!freeAddress) {
      // could not find in cycle above, give up
      freeAddress = this._getInternalAddressByIndex(this.next_free_change_address_index + c); // we didnt check this one, maybe its free
      this.next_free_change_address_index += c; // now points to this one
    }
    this._address = freeAddress;
    return freeAddress;
  }

  /**
   * Should not be used in HD wallets
   *
   * @deprecated
   * @return {string}
   */
  getAddress(): string | false {
    return this._address;
  }

  _getExternalWIFByIndex(index: number): string | false {
    throw new Error('Not implemented');
  }

  _getInternalWIFByIndex(index: number): string | false {
    throw new Error('Not implemented');
  }

  _getExternalAddressByIndex(index: number): string {
    throw new Error('Not implemented');
  }

  _getInternalAddressByIndex(index: number): string {
    throw new Error('Not implemented');
  }

  getXpub(): string {
    throw new Error('Not implemented');
  }

  /**
   * Async function to fetch all transactions. Use getter to get actual txs.
   * Also, sets internals:
   *  `this.internal_addresses_cache`
   *  `this.external_addresses_cache`
   *
   * @returns {Promise<void>}
   */
  async fetchTransactions(): Promise<void> {
    throw new Error('not implemented');
  }

  /**
   * Given that `address` is in our HD hierarchy, try to find
   * corresponding WIF
   *
   * @param address {String} In our HD hierarchy
   * @return {String} WIF if found
   */
  _getWifForAddress(address: string): string {
    if (this._address_to_wif_cache[address]) return this._address_to_wif_cache[address]; // cache hit

    // fast approach, first lets iterate over all addressess we have in cache
    for (const indexStr of Object.keys(this.internal_addresses_cache)) {
      const index = parseInt(indexStr, 10);
      if (this._getInternalAddressByIndex(index) === address) {
        return (this._address_to_wif_cache[address] = <string>this._getInternalWIFByIndex(index));
      }
    }

    for (const indexStr of Object.keys(this.external_addresses_cache)) {
      const index = parseInt(indexStr, 10);
      if (this._getExternalAddressByIndex(index) === address) {
        return (this._address_to_wif_cache[address] = <string>this._getExternalWIFByIndex(index));
      }
    }

    // no luck - lets iterate over all addresses we have up to first unused address index
    for (let c = 0; c <= this.next_free_change_address_index + this.gap_limit; c++) {
      const possibleAddress = this._getInternalAddressByIndex(c);
      if (possibleAddress === address) {
        return (this._address_to_wif_cache[address] = <string>this._getInternalWIFByIndex(c));
      }
    }

    for (let c = 0; c <= this.next_free_address_index + this.gap_limit; c++) {
      const possibleAddress = this._getExternalAddressByIndex(c);
      if (possibleAddress === address) {
        return (this._address_to_wif_cache[address] = <string>this._getExternalWIFByIndex(c));
      }
    }

    throw new Error('Could not find WIF for ' + address);
  }

  async fetchBalance(): Promise<void> {
    throw new Error('Not implemented');
  }

  /**
   * @inheritDoc
   */
  async fetchUtxo(): Promise<void> {
    throw new Error('Not implemented');
  }

  _getDerivationPathByAddress(address: string): string | false {
    throw new Error('Not implemented');
  }

  _getNodePubkeyByIndex(node: number, index: number): Buffer | undefined {
    throw new Error('Not implemented');
  }

  /**
   * @returns {string} Root derivation path for wallet if any
   */
  getDerivationPath() {
    return this._derivationPath;
  }

  /*
   * Set derivation path for the wallet
   *
   * @param {String} path - path
   */
  setDerivationPath(path: string) {
    this._derivationPath = path;
  }
}
