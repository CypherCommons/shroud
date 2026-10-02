/* eslint react/prop-types: "off", @typescript-eslint/ban-ts-comment: "off", camelcase: "off"   */
import BigNumber from 'bignumber.js';
import b58 from 'bs58check';
import BIP32Factory, { BIP32Interface } from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';
import coinSelect, { CoinSelectOutput, CoinSelectReturnInput, CoinSelectTarget } from 'coinselect';
import coinSelectSplit from 'coinselect/split';
import * as utils from 'coinselect/utils';
import { ECPairFactory, ECPairInterface } from 'ecpair';

import * as Electrum from '../../modules/Electrum';
import { ElectrumHistory } from '../../modules/Electrum';
import ecc from '../../modules/noble_ecc';
import { randomBytes } from '../rng';
import { AbstractHDWallet } from './abstract-hd-wallet';
import { CreateTransactionResult, CreateTransactionTarget, CreateTransactionUtxo, Transaction, Utxo } from './types';
import { isSilentPaymentAddress, resolveSilentPaymentTargets } from '../../helpers/silent-payments';
import { isValidBech32Address } from '../../utils/isValidBech32Address';
import type { PrivateKey } from '@silent-pay/core';

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

/**
 * SLIP-132 public version bytes for a native-segwit extended key, which bitcoinjs `Network` does
 * not carry. Keyed by BIP-44 coin type: mainnet zpub, test-chain vpub.
 */
const SLIP132_P2WPKH_PUBLIC_VERSION: Record<number, string> = { 0: '04b24746', 1: '045f1cf6' };

// `OP_1 <32-byte x-only pubkey>`
const P2TR_SCRIPT_LENGTH = 34;
const P2PKH_SCRIPT_LENGTH = 25;

/**
 * coinselect appends its change output as a bare `{ value }`. An output with no address but
 * with `script.hex` is a custom script (OP_RETURN), not change - see `CreateTransactionTarget`.
 */
const isChangeOutput = (output: { address?: string; script?: { hex?: string } }) => !output.address && !output.script?.hex;

type BalanceByIndex = {
  c: number;
  u: number;
};

/**
 * Electrum - means that it utilizes Electrum protocol for blockchain data
 */
export class AbstractHDElectrumWallet extends AbstractHDWallet {
  static readonly type = 'abstract';
  static readonly typeReadable = 'abstract';
  static defaultRBFSequence = 2147483648; // 1 << 31, minimum for replaceable transactions as per BIP68
  static finalRBFSequence = 4294967295; // 0xFFFFFFFF
  // @ts-ignore: override
  public readonly type = AbstractHDElectrumWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = AbstractHDElectrumWallet.typeReadable;

  _balances_by_external_index: Record<number, BalanceByIndex>;
  _balances_by_internal_index: Record<number, BalanceByIndex>;

  // @ts-ignore
  _txs_by_external_index: Record<number, Transaction[]>;
  // @ts-ignore
  _txs_by_internal_index: Record<number, Transaction[]>;

  _utxo: any[];
  _fp: string;

  constructor() {
    super();
    this._balances_by_external_index = {}; //  0 => { c: 0, u: 0 } // confirmed/unconfirmed
    this._balances_by_internal_index = {};

    this._txs_by_external_index = {};
    this._txs_by_internal_index = {};

    this._utxo = [];

    // cache
    this._fp = '';
  }

  /**
   * @inheritDoc
   */
  getBalance() {
    let ret = 0;
    for (const bal of Object.values(this._balances_by_external_index)) {
      ret += bal.c;
    }
    for (const bal of Object.values(this._balances_by_internal_index)) {
      ret += bal.c;
    }
    return ret + (this.getUnconfirmedBalance() < 0 ? this.getUnconfirmedBalance() : 0);
  }

  /**
   *
   * @inheritDoc
   */
  getUnconfirmedBalance() {
    let ret = 0;
    for (const bal of Object.values(this._balances_by_external_index)) {
      ret += bal.u;
    }
    for (const bal of Object.values(this._balances_by_internal_index)) {
      ret += bal.u;
    }
    return ret;
  }

  async generate() {
    const buf = await randomBytes(16);
    this.secret = bip39.entropyToMnemonic(buf.toString('hex'));
  }

  async generateFromEntropy(user: Buffer) {
    if (user.length !== 32 && user.length !== 16) {
      throw new Error('Entropy has to be 16 or 32 bytes long');
    }
    this.secret = bip39.entropyToMnemonic(user.toString('hex'));
  }

  _getExternalWIFByIndex(index: number): string | false {
    return this._getWIFByIndex(false, index);
  }

  _getInternalWIFByIndex(index: number): string | false {
    return this._getWIFByIndex(true, index);
  }

  /**
   * Get internal/external WIF by wallet index
   * @param {Boolean} internal
   * @param {Number} index
   * @returns {string|false} Either string WIF or FALSE if error happened
   * @private
   */
  _getWIFByIndex(internal: boolean, index: number): string | false {
    if (!this.secret) return false;
    const seed = this._getSeed();
    // The network sets the WIF version byte (0x80 mainnet, 0xEF test chains), so it has to be
    // threaded through here and not just at address-encoding time.
    const root = bip32.fromSeed(seed, this.getNetworkConfig().bitcoinjs);
    const path = `${this.getDerivationPath()}/${internal ? 1 : 0}/${index}`;
    const child = root.derivePath(path);

    return child.toWIF();
  }

  _getNodeAddressByIndex(node: number, index: number): string {
    index = index * 1; // cast to int
    const network = this.getNetworkConfig().bitcoinjs;
    if (node === 0) {
      if (this.external_addresses_cache[index]) return this.external_addresses_cache[index]; // cache hit
    }

    if (node === 1) {
      if (this.internal_addresses_cache[index]) return this.internal_addresses_cache[index]; // cache hit
    }

    if (node === 0 && !this._node0) {
      const xpub = this._zpubToXpub(this.getXpub());
      const hdNode = bip32.fromBase58(xpub, network);
      this._node0 = hdNode.derive(node);
    }

    if (node === 1 && !this._node1) {
      const xpub = this._zpubToXpub(this.getXpub());
      const hdNode = bip32.fromBase58(xpub, network);
      this._node1 = hdNode.derive(node);
    }

    let address: string;
    if (node === 0) {
      // @ts-ignore
      address = this._hdNodeToAddress(this._node0.derive(index));
    } else {
      // tbh the only possible else is node === 1
      // @ts-ignore
      address = this._hdNodeToAddress(this._node1.derive(index));
    }

    if (node === 0) {
      return (this.external_addresses_cache[index] = address);
    } else {
      // tbh the only possible else option is node === 1
      return (this.internal_addresses_cache[index] = address);
    }
  }

  _getNodePubkeyByIndex(node: number, index: number) {
    index = index * 1; // cast to int
    const network = this.getNetworkConfig().bitcoinjs;

    if (node === 0 && !this._node0) {
      const xpub = this._zpubToXpub(this.getXpub());
      const hdNode = bip32.fromBase58(xpub, network);
      this._node0 = hdNode.derive(node);
    }

    if (node === 1 && !this._node1) {
      const xpub = this._zpubToXpub(this.getXpub());
      const hdNode = bip32.fromBase58(xpub, network);
      this._node1 = hdNode.derive(node);
    }

    if (node === 0 && this._node0) {
      return this._node0.derive(index).publicKey;
    }

    if (node === 1 && this._node1) {
      return this._node1.derive(index).publicKey;
    }

    throw new Error('Internal error: this._node0 or this._node1 is undefined');
  }

  _getExternalAddressByIndex(index: number): string {
    return this._getNodeAddressByIndex(0, index);
  }

  _getInternalAddressByIndex(index: number) {
    return this._getNodeAddressByIndex(1, index);
  }

  /**
   * Returning zpub actually, not xpub. Keeping same method name
   * for compatibility.
   *
   * @return {String} zpub
   */
  getXpub() {
    if (this._xpub) {
      return this._xpub; // cache hit
    }
    // first, getting xpub
    const seed = this._getSeed();
    const root = bip32.fromSeed(seed, this.getNetworkConfig().bitcoinjs);

    const path = this.getDerivationPath();
    if (!path) {
      throw new Error('Internal error: no path');
    }
    const child = root.derivePath(path).neutered();
    const xpub = child.toBase58();

    // bitcoinjs does not support zpub yet (nor its vpub test-chain counterpart), so we convert
    // from the xpub/tpub the network handed us
    const version = Buffer.from(SLIP132_P2WPKH_PUBLIC_VERSION[this.getNetworkConfig().coinType], 'hex');
    this._xpub = b58.encode(Buffer.concat([version, b58.decode(xpub).slice(4)]));

    return this._xpub;
  }

  /**
   * @inheritDoc
   */
  async fetchTransactions() {
    // if txs are absent for some internal address in hierarchy - this is a sign
    // we should fetch txs for that address
    // OR if some address has unconfirmed balance - should fetch it's txs
    // OR some tx for address is unconfirmed
    // OR some tx has < 7 confirmations

    // fetching transactions in batch: first, getting batch history for all addresses,
    // then batch fetching all involved txids
    // finally, batch fetching txids of all inputs (needed to see amounts & addresses of those inputs)
    // then we combine it all together

    const addresses2fetch = [];
    // Store these values to avoid a race condition if fetchBalance func changes them
    const next_free_address_index = this.next_free_address_index;
    const next_free_change_address_index = this.next_free_change_address_index;

    for (let c = 0; c < next_free_address_index + this.gap_limit; c++) {
      // external addresses first
      let hasUnconfirmed = false;
      this._txs_by_external_index[c] = this._txs_by_external_index[c] || [];
      for (const tx of this._txs_by_external_index[c]) hasUnconfirmed = hasUnconfirmed || !tx.confirmations || tx.confirmations < 7;

      if (hasUnconfirmed || this._txs_by_external_index[c].length === 0 || this._balances_by_external_index[c].u !== 0) {
        addresses2fetch.push(this._getExternalAddressByIndex(c));
      }
    }

    for (let c = 0; c < next_free_change_address_index + this.gap_limit; c++) {
      // next, internal addresses
      let hasUnconfirmed = false;
      this._txs_by_internal_index[c] = this._txs_by_internal_index[c] || [];
      for (const tx of this._txs_by_internal_index[c]) hasUnconfirmed = hasUnconfirmed || !tx.confirmations || tx.confirmations < 7;

      if (hasUnconfirmed || this._txs_by_internal_index[c].length === 0 || this._balances_by_internal_index[c].u !== 0) {
        addresses2fetch.push(this._getInternalAddressByIndex(c));
      }
    }

    // first: batch fetch for all addresses histories
    const histories = await Electrum.multiGetHistoryByAddress(addresses2fetch);
    const txs: Record<string, ElectrumHistory> = {};
    for (const history of Object.values(histories)) {
      for (const tx of history as ElectrumHistory[]) {
        txs[tx.tx_hash] = tx;
      }
    }

    // next, batch fetching each txid we got
    const txdatas = await Electrum.multiGetTransactionByTxid(Object.keys(txs), true);

    // now, tricky part. we collect all transactions from inputs (vin), and batch fetch them too.
    // then we combine all this data (we need inputs to see source addresses and amounts)
    const vinTxids = [];
    for (const txdata of Object.values(txdatas)) {
      if (txdata.vin.length > 99) continue;
      // ^^^ cutoff, some transactions have thousands of inputs, so the resulting array of txs for inputs to fetch
      // might be dozens of thousands. too much to handle, so we skip such transactions
      for (const vin of txdata.vin) {
        vin.txid && vinTxids.push(vin.txid);
        // ^^^^ not all inputs have txid, some of them are Coinbase (newly-created coins)
      }
    }
    const vintxdatas = await Electrum.multiGetTransactionByTxid(vinTxids, true);

    // fetched all transactions from our inputs. now we need to combine it.
    // iterating all _our_ transactions:
    for (const txid of Object.keys(txdatas)) {
      // iterating all inputs our our single transaction:
      for (let inpNum = 0; inpNum < txdatas[txid].vin.length; inpNum++) {
        const inpTxid = txdatas[txid].vin[inpNum].txid;
        const inpVout = txdatas[txid].vin[inpNum].vout;
        // got txid and output number of _previous_ transaction we shoud look into
        if (vintxdatas[inpTxid]?.vout[inpVout]) {
          // extracting amount & addresses from previous output and adding it to _our_ input:
          txdatas[txid].vin[inpNum].addresses = vintxdatas[inpTxid].vout[inpVout].scriptPubKey.addresses;
          txdatas[txid].vin[inpNum].value = vintxdatas[inpTxid].vout[inpVout].value;
        }
      }
    }

    // now purge all unconfirmed txs from internal hashmaps, since some may be evicted from mempool because they became invalid
    // or replaced. hashmaps are going to be re-populated anyways, since we fetched TXs for addresses with unconfirmed TXs
    for (let c = 0; c < next_free_address_index + this.gap_limit; c++) {
      this._txs_by_external_index[c] = this._txs_by_external_index[c].filter(tx => !!tx.confirmations);
    }
    for (let c = 0; c < next_free_change_address_index + this.gap_limit; c++) {
      this._txs_by_internal_index[c] = this._txs_by_internal_index[c].filter(tx => !!tx.confirmations);
    }

    // now, we need to put transactions in all relevant `cells` of internal hashmaps:
    // this._txs_by_internal_index & this._txs_by_external_index

    for (let c = 0; c < next_free_address_index + this.gap_limit; c++) {
      for (const tx of Object.values(txdatas)) {
        for (const vin of tx.vin) {
          if (vin.addresses && vin.addresses.indexOf(this._getExternalAddressByIndex(c)) !== -1) {
            // this TX is related to our address
            this._txs_by_external_index[c] = this._txs_by_external_index[c] || [];
            const { vin: txVin, vout: txVout, ...txRest } = tx;
            const clonedTx = {
              ...txRest,
              inputs: txVin.slice(0),
              outputs: txVout.slice(0),
              timestamp: tx.blocktime || tx.time || Math.floor(+new Date() / 1000) - 30 /* unconfirmed */,
            };

            // trying to replace tx if it exists already (because it has lower confirmations, for example)
            let replaced = false;
            for (let cc = 0; cc < this._txs_by_external_index[c].length; cc++) {
              if (this._txs_by_external_index[c][cc].txid === clonedTx.txid) {
                replaced = true;
                this._txs_by_external_index[c][cc] = clonedTx;
              }
            }
            if (!replaced) this._txs_by_external_index[c].push(clonedTx);
          }
        }
        for (const vout of tx.vout) {
          if (vout.scriptPubKey.addresses && vout.scriptPubKey.addresses.indexOf(this._getExternalAddressByIndex(c)) !== -1) {
            // this TX is related to our address
            this._txs_by_external_index[c] = this._txs_by_external_index[c] || [];
            const { vin: txVin, vout: txVout, ...txRest } = tx;
            const clonedTx = {
              ...txRest,
              inputs: txVin.slice(0),
              outputs: txVout.slice(0),
              timestamp: tx.blocktime || tx.time || Math.floor(+new Date() / 1000) - 30 /* unconfirmed */,
            };

            // trying to replace tx if it exists already (because it has lower confirmations, for example)
            let replaced = false;
            for (let cc = 0; cc < this._txs_by_external_index[c].length; cc++) {
              if (this._txs_by_external_index[c][cc].txid === clonedTx.txid) {
                replaced = true;
                this._txs_by_external_index[c][cc] = clonedTx;
              }
            }
            if (!replaced) this._txs_by_external_index[c].push(clonedTx);
          }
        }
      }
    }

    for (let c = 0; c < next_free_change_address_index + this.gap_limit; c++) {
      for (const tx of Object.values(txdatas)) {
        for (const vin of tx.vin) {
          if (vin.addresses && vin.addresses.indexOf(this._getInternalAddressByIndex(c)) !== -1) {
            // this TX is related to our address
            this._txs_by_internal_index[c] = this._txs_by_internal_index[c] || [];
            const { vin: txVin, vout: txVout, ...txRest } = tx;
            const clonedTx = {
              ...txRest,
              inputs: txVin.slice(0),
              outputs: txVout.slice(0),
              timestamp: tx.blocktime || tx.time || Math.floor(+new Date() / 1000) - 30 /* unconfirmed */,
            };

            // trying to replace tx if it exists already (because it has lower confirmations, for example)
            let replaced = false;
            for (let cc = 0; cc < this._txs_by_internal_index[c].length; cc++) {
              if (this._txs_by_internal_index[c][cc].txid === clonedTx.txid) {
                replaced = true;
                this._txs_by_internal_index[c][cc] = clonedTx;
              }
            }
            if (!replaced) this._txs_by_internal_index[c].push(clonedTx);
          }
        }
        for (const vout of tx.vout) {
          if (vout.scriptPubKey.addresses && vout.scriptPubKey.addresses.indexOf(this._getInternalAddressByIndex(c)) !== -1) {
            // this TX is related to our address
            this._txs_by_internal_index[c] = this._txs_by_internal_index[c] || [];
            const { vin: txVin, vout: txVout, ...txRest } = tx;
            const clonedTx = {
              ...txRest,
              inputs: txVin.slice(0),
              outputs: txVout.slice(0),
              timestamp: tx.blocktime || tx.time || Math.floor(+new Date() / 1000) - 30 /* unconfirmed */,
            };

            // trying to replace tx if it exists already (because it has lower confirmations, for example)
            let replaced = false;
            for (let cc = 0; cc < this._txs_by_internal_index[c].length; cc++) {
              if (this._txs_by_internal_index[c][cc].txid === clonedTx.txid) {
                replaced = true;
                this._txs_by_internal_index[c][cc] = clonedTx;
              }
            }
            if (!replaced) this._txs_by_internal_index[c].push(clonedTx);
          }
        }
      }
    }

    this._lastTxFetch = +new Date();
  }

  getTransactions() {
    let txs: Transaction[] = [];

    for (const addressTxs of Object.values(this._txs_by_external_index)) {
      txs = txs.concat(addressTxs);
    }
    for (const addressTxs of Object.values(this._txs_by_internal_index)) {
      txs = txs.concat(addressTxs);
    }

    if (txs.length === 0) return []; // guard clause; so we wont spend time calculating addresses

    // its faster to pre-build hashmap of owned addresses than to query `this.weOwnAddress()`, which in turn
    // iterates over all addresses in hierarchy
    const ownedAddressesHashmap: Record<string, boolean> = {};
    for (let c = 0; c < this.next_free_address_index + 1; c++) {
      ownedAddressesHashmap[this._getExternalAddressByIndex(c)] = true;
    }
    for (let c = 0; c < this.next_free_change_address_index + 1; c++) {
      ownedAddressesHashmap[this._getInternalAddressByIndex(c)] = true;
    }
    // hack: in case this code is called from LegacyWallet:
    if (this.getAddress()) ownedAddressesHashmap[String(this.getAddress())] = true;

    const ret: Transaction[] = [];
    for (const tx of txs) {
      tx.timestamp = tx.blocktime;
      if (!tx.blocktime) tx.timestamp = Math.floor(+new Date() / 1000) - 30; // unconfirmed
      tx.confirmations = tx.confirmations || 0; // unconfirmed
      tx.hash = tx.txid;
      tx.value = 0;

      for (const vin of tx.inputs) {
        // if input (spending) goes from our address - we are loosing!
        if ((vin.address && ownedAddressesHashmap[vin.address]) || (vin.addresses?.[0] && ownedAddressesHashmap[vin.addresses[0]])) {
          tx.value -= new BigNumber(vin.value ?? 0).multipliedBy(100000000).toNumber();
        }
      }

      for (const vout of tx.outputs) {
        // when output goes to our address - this means we are gaining!
        if (vout.scriptPubKey.addresses?.[0] && ownedAddressesHashmap[vout.scriptPubKey.addresses[0]]) {
          tx.value += new BigNumber(vout.value).multipliedBy(100000000).toNumber();
        }
      }

      ret.push(tx);
    }

    // now, deduplication:
    const usedTxIds: Record<string, number> = {};
    const ret2 = [];
    for (const tx of ret) {
      if (!usedTxIds[tx.txid]) ret2.push(tx);
      usedTxIds[tx.txid] = 1;
    }

    return ret2.sort(function (a, b) {
      return Number(b.timestamp) - Number(a.timestamp);
    });
  }

  async _binarySearchIterationForInternalAddress(index: number) {
    const gerenateChunkAddresses = (chunkNum: number) => {
      const ret = [];
      for (let c = this.gap_limit * chunkNum; c < this.gap_limit * (chunkNum + 1); c++) {
        ret.push(this._getInternalAddressByIndex(c));
      }
      return ret;
    };

    let lastChunkWithUsedAddressesNum = null;
    let lastHistoriesWithUsedAddresses = null;
    for (let c = 0; c < Math.round(index / this.gap_limit); c++) {
      const histories = await Electrum.multiGetHistoryByAddress(gerenateChunkAddresses(c));
      // @ts-ignore
      if (this.constructor._getTransactionsFromHistories(histories).length > 0) {
        // in this particular chunk we have used addresses
        lastChunkWithUsedAddressesNum = c;
        lastHistoriesWithUsedAddresses = histories;
      } else {
        // empty chunk. no sense searching more chunks
        break;
      }
    }

    let lastUsedIndex = 0;

    if (lastHistoriesWithUsedAddresses) {
      // now searching for last used address in batch lastChunkWithUsedAddressesNum
      for (
        let c = Number(lastChunkWithUsedAddressesNum) * this.gap_limit;
        c < Number(lastChunkWithUsedAddressesNum) * this.gap_limit + this.gap_limit;
        c++
      ) {
        const address = this._getInternalAddressByIndex(c);
        if (lastHistoriesWithUsedAddresses[address] && lastHistoriesWithUsedAddresses[address].length > 0) {
          lastUsedIndex = Math.max(c, lastUsedIndex) + 1; // point to next, which is supposed to be unused
        }
      }
    }

    return lastUsedIndex;
  }

  async _binarySearchIterationForExternalAddress(index: number) {
    const gerenateChunkAddresses = (chunkNum: number) => {
      const ret = [];
      for (let c = this.gap_limit * chunkNum; c < this.gap_limit * (chunkNum + 1); c++) {
        ret.push(this._getExternalAddressByIndex(c));
      }
      return ret;
    };

    let lastChunkWithUsedAddressesNum = null;
    let lastHistoriesWithUsedAddresses = null;
    for (let c = 0; c < Math.round(index / this.gap_limit); c++) {
      const histories = await Electrum.multiGetHistoryByAddress(gerenateChunkAddresses(c));
      // @ts-ignore
      if (this.constructor._getTransactionsFromHistories(histories).length > 0) {
        // in this particular chunk we have used addresses
        lastChunkWithUsedAddressesNum = c;
        lastHistoriesWithUsedAddresses = histories;
      } else {
        // empty chunk. no sense searching more chunks
        break;
      }
    }

    let lastUsedIndex = 0;

    if (lastHistoriesWithUsedAddresses) {
      // now searching for last used address in batch lastChunkWithUsedAddressesNum
      for (
        let c = Number(lastChunkWithUsedAddressesNum) * this.gap_limit;
        c < Number(lastChunkWithUsedAddressesNum) * this.gap_limit + this.gap_limit;
        c++
      ) {
        const address = this._getExternalAddressByIndex(c);
        if (lastHistoriesWithUsedAddresses[address] && lastHistoriesWithUsedAddresses[address].length > 0) {
          lastUsedIndex = Math.max(c, lastUsedIndex) + 1; // point to next, which is supposed to be unused
        }
      }
    }

    return lastUsedIndex;
  }

  async fetchBalance() {
    try {
      if (this.next_free_change_address_index === 0 && this.next_free_address_index === 0) {
        // doing binary search for last used address:
        this.next_free_change_address_index = await this._binarySearchIterationForInternalAddress(1000);
        this.next_free_address_index = await this._binarySearchIterationForExternalAddress(1000);
      } // end rescanning fresh wallet

      // finally fetching balance
      await this._fetchBalance();
    } catch (err) {
      console.warn(err);
    }
  }

  async _fetchBalance() {
    // probing future addressess in hierarchy whether they have any transactions, in case
    // our 'next free addr' pointers are lagging behind
    // for that we are gona batch fetch history for all addresses between last used and last used + gap_limit

    const lagAddressesToFetch = [];
    for (let c = this.next_free_address_index; c < this.next_free_address_index + this.gap_limit; c++) {
      lagAddressesToFetch.push(this._getExternalAddressByIndex(c));
    }
    for (let c = this.next_free_change_address_index; c < this.next_free_change_address_index + this.gap_limit; c++) {
      lagAddressesToFetch.push(this._getInternalAddressByIndex(c));
    }

    const txs = await Electrum.multiGetHistoryByAddress(lagAddressesToFetch); // <------ electrum call

    for (let c = this.next_free_address_index; c < this.next_free_address_index + this.gap_limit; c++) {
      const address = this._getExternalAddressByIndex(c);
      if (txs[address] && Array.isArray(txs[address]) && txs[address].length > 0) {
        // whoa, someone uses our wallet outside! better catch up
        this.next_free_address_index = c + 1;
      }
    }

    for (let c = this.next_free_change_address_index; c < this.next_free_change_address_index + this.gap_limit; c++) {
      const address = this._getInternalAddressByIndex(c);
      if (txs[address] && Array.isArray(txs[address]) && txs[address].length > 0) {
        // whoa, someone uses our wallet outside! better catch up
        this.next_free_change_address_index = c + 1;
      }
    }

    // next, business as usuall. fetch balances

    const addresses2fetch = [];

    // generating all involved addresses.
    // basically, refetch all from index zero to maximum. doesnt matter
    // since we batch them 100 per call

    // external
    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      addresses2fetch.push(this._getExternalAddressByIndex(c));
    }

    // internal
    for (let c = 0; c < this.next_free_change_address_index + this.gap_limit; c++) {
      addresses2fetch.push(this._getInternalAddressByIndex(c));
    }

    const balances = await Electrum.multiGetBalanceByAddress(addresses2fetch);

    // converting to a more compact internal format
    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      const addr = this._getExternalAddressByIndex(c);
      if (balances.addresses[addr]) {
        // first, if balances differ from what we store - we delete transactions for that
        // address so next fetchTransactions() will refetch everything
        if (this._balances_by_external_index[c]) {
          if (
            this._balances_by_external_index[c].c !== balances.addresses[addr].confirmed ||
            this._balances_by_external_index[c].u !== balances.addresses[addr].unconfirmed
          ) {
            delete this._txs_by_external_index[c];
          }
        }
        // update local representation of balances on that address:
        this._balances_by_external_index[c] = {
          c: balances.addresses[addr].confirmed,
          u: balances.addresses[addr].unconfirmed,
        };
      }
    }
    for (let c = 0; c < this.next_free_change_address_index + this.gap_limit; c++) {
      const addr = this._getInternalAddressByIndex(c);
      if (balances.addresses[addr]) {
        // first, if balances differ from what we store - we delete transactions for that
        // address so next fetchTransactions() will refetch everything
        if (this._balances_by_internal_index[c]) {
          if (
            this._balances_by_internal_index[c].c !== balances.addresses[addr].confirmed ||
            this._balances_by_internal_index[c].u !== balances.addresses[addr].unconfirmed
          ) {
            delete this._txs_by_internal_index[c];
          }
        }
        // update local representation of balances on that address:
        this._balances_by_internal_index[c] = {
          c: balances.addresses[addr].confirmed,
          u: balances.addresses[addr].unconfirmed,
        };
      }
    }

    this._lastBalanceFetch = +new Date();
  }

  async fetchUtxo(): Promise<void> {
    // fetching utxo of addresses that only have some balance
    let addressess = [];

    // considering confirmed balance:
    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      if (this._balances_by_external_index?.[c]?.c > 0) {
        addressess.push(this._getExternalAddressByIndex(c));
      }
    }
    for (let c = 0; c < this.next_free_change_address_index + this.gap_limit; c++) {
      if (this._balances_by_internal_index?.[c]?.c > 0) {
        addressess.push(this._getInternalAddressByIndex(c));
      }
    }

    // considering UNconfirmed balance:
    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      if (this._balances_by_external_index?.[c]?.u > 0) {
        addressess.push(this._getExternalAddressByIndex(c));
      }
    }
    for (let c = 0; c < this.next_free_change_address_index + this.gap_limit; c++) {
      if (this._balances_by_internal_index?.[c]?.u > 0) {
        addressess.push(this._getInternalAddressByIndex(c));
      }
    }

    // note: we could remove checks `.c` and `.u` to simplify code, but the resulting `addressess` array would be bigger, thus bigger batch
    // to fetch (or maybe even several fetches), which is not critical but undesirable.
    // anyway, result has `.confirmations` property for each utxo, so outside caller can easily filter out unconfirmed if he wants to

    addressess = [...new Set(addressess)]; // deduplicate just for any case

    const fetchedUtxo = await Electrum.multiGetUtxoByAddress(addressess);
    this._utxo = [];
    for (const arr of Object.values(fetchedUtxo)) {
      this._utxo = this._utxo.concat(arr);
    }

    // this belongs in `.getUtxo()`
    for (const u of this._utxo) {
      u.wif = this._getWifForAddress(u.address);
      if (!u.confirmations && u.height) u.confirmations = Electrum.estimateCurrentBlockheight() - u.height;
    }

    this._utxo = this._utxo.sort((a, b) => Number(a.value) - Number(b.value));
    // more consistent, so txhex in unit tests wont change
  }

  /**
   * Getter for previously fetched UTXO. For example:
   *     [ { height: 0,
   *    value: 666,
   *    address: 'string',
   *    vout: 1,
   *    txid: 'string',
   *    wif: 'string',
   *    confirmations: 0 } ]
   *
   * @param respectFrozen {boolean} Add Frozen outputs
   * @returns {[]}
   */
  getUtxo(respectFrozen = false) {
    let ret = [];

    if (this._utxo.length === 0) {
      ret = this.getDerivedUtxoFromOurTransaction(); // oy vey, no stored utxo. lets attempt to derive it from stored transactions
    } else {
      ret = this._utxo;
    }
    if (!respectFrozen) {
      ret = ret.filter(({ txid, vout }) => !this.getUTXOMetadata(txid, vout).frozen);
    }
    return ret;
  }

  getDerivedUtxoFromOurTransaction(returnSpentUtxoAsWell = false): Utxo[] {
    const utxos: Utxo[] = [];

    // its faster to pre-build hashmap of owned addresses than to query `this.weOwnAddress()`, which in turn
    // iterates over all addresses in hierarchy
    const ownedAddressesHashmap: Record<string, boolean> = {};
    for (let c = 0; c < this.next_free_address_index + 1; c++) {
      ownedAddressesHashmap[this._getExternalAddressByIndex(c)] = true;
    }
    for (let c = 0; c < this.next_free_change_address_index + 1; c++) {
      ownedAddressesHashmap[this._getInternalAddressByIndex(c)] = true;
    }

    for (const tx of this.getTransactions()) {
      for (const output of tx.outputs) {
        let address: string | false = false;
        if (output.scriptPubKey && output.scriptPubKey.addresses && output.scriptPubKey.addresses[0]) {
          address = output.scriptPubKey.addresses[0];
        }
        if (ownedAddressesHashmap[String(address)]) {
          const value = new BigNumber(output.value).multipliedBy(100000000).toNumber();
          utxos.push({
            txid: tx.txid,
            vout: output.n,
            address: String(address),
            value,
            confirmations: tx.confirmations,
            wif: false,
            height: Electrum.estimateCurrentBlockheight() - (tx.confirmations ?? 0),
          });
        }
      }
    }

    if (returnSpentUtxoAsWell) return utxos;

    // got all utxos we ever had. lets filter out the ones that are spent:
    const ret = [];
    for (const utxo of utxos) {
      let spent = false;
      for (const tx of this.getTransactions()) {
        for (const input of tx.inputs) {
          if (input.txid === utxo.txid && input.vout === utxo.vout) spent = true;
          // utxo we got previously was actually spent right here ^^
        }
      }

      if (!spent) {
        // filling WIFs only for legit unspent UTXO, as it is a slow operation
        utxo.wif = this._getWifForAddress(utxo.address);
        ret.push(utxo);
      }
    }

    return ret;
  }

  _getDerivationPathByAddress(address: string): string | false {
    const path = this.getDerivationPath();
    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      if (this._getExternalAddressByIndex(c) === address) return path + '/0/' + c;
    }
    for (let c = 0; c < this.next_free_change_address_index + this.gap_limit; c++) {
      if (this._getInternalAddressByIndex(c) === address) return path + '/1/' + c;
    }

    return false;
  }

  /**
   *
   * @param address {string} Address that belongs to this wallet
   * @returns {Buffer|false} Either buffer with pubkey or false
   */
  _getPubkeyByAddress(address: string): Buffer | false {
    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      if (this._getExternalAddressByIndex(c) === address) return this._getNodePubkeyByIndex(0, c);
    }
    for (let c = 0; c < this.next_free_change_address_index + this.gap_limit; c++) {
      if (this._getInternalAddressByIndex(c) === address) return this._getNodePubkeyByIndex(1, c);
    }

    return false;
  }

  /**
   * Finds WIF corresponding to address and returns it
   *
   * @param address {string} Address that belongs to this wallet
   * @returns {string|false} WIF or false
   */
  _getWIFbyAddress(address: string): string | false {
    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      if (this._getExternalAddressByIndex(c) === address) return this._getWIFByIndex(false, c);
    }
    for (let c = 0; c < this.next_free_change_address_index + this.gap_limit; c++) {
      if (this._getInternalAddressByIndex(c) === address) return this._getWIFByIndex(true, c);
    }
    return false;
  }

  weOwnAddress(address: string) {
    return this.findAddressIndex(address) !== null;
  }

  /**
   * Same as weOwnAddress(), but returns the derivation index and chain instead of a boolean.
   *
   * @param address {string} Address that belongs to this wallet
   * @returns {{internal: boolean, index: number} | null}
   */
  findAddressIndex(address: string): { internal: boolean; index: number } | null {
    if (!address) return null;
    let cleanAddress = address;

    const isBech32Address = isValidBech32Address(address, this.getNetworkConfig().bitcoinjs);

    if (isBech32Address) {
      cleanAddress = address.toLocaleLowerCase();
    }

    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      if (this._getExternalAddressByIndex(c) === cleanAddress) return { internal: false, index: c };
    }
    for (let c = 0; c < this.next_free_change_address_index + this.gap_limit; c++) {
      if (this._getInternalAddressByIndex(c) === cleanAddress) return { internal: true, index: c };
    }
    return null;
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
    targets: CreateTransactionTarget[],
    feeRate: number,
    changeAddress: string,
    sequence: number = AbstractHDElectrumWallet.defaultRBFSequence,
    skipSigning = false,
    masterFingerprint: number = 0,
  ): CreateTransactionResult {
    if (targets.length === 0) throw new Error('No destination provided');

    let { inputs, outputs, fee } = this.coinselect(utxos, targets, feeRate);
    const network = this.getNetworkConfig().bitcoinjs;

    const hasSilentPaymentOutput: boolean = !!outputs.find(o => isSilentPaymentAddress(o.address, network));
    if (hasSilentPaymentOutput) {
      if (!this.allowSilentPaymentSend()) {
        throw new Error('This wallet can not send to SilentPayment address');
      }

      // BIP-352 only lets some input types contribute to the shared secret. Taproot inputs are
      // summed as x-only keys (negated when the Y coordinate is odd); p2wpkh and p2sh-p2wpkh
      // contribute their private key as-is. Anything else is ineligible, and summing its key
      // anyway would produce an output the recipient can never find — so refuse rather than
      // default. For a single wallet all utxos are the same type, so this is decided once.
      let isXOnly: boolean;
      switch (this.segwitType) {
        case 'p2tr':
          isXOnly = true;
          break;
        case 'p2wpkh':
        case 'p2sh(p2wpkh)':
          isXOnly = false;
          break;
        default:
          throw new Error(`Cannot send to a silent payment address: ${this.segwitType ?? 'this'} wallet inputs are not BIP-352 eligible`);
      }
      const inputPrivateKeys: PrivateKey[] = inputs.map(u => {
        const wifForInput = u.wif ?? this._getWifForAddress(String(u.address));
        const keyPair = ECPair.fromWIF(wifForInput, network);
        if (!keyPair.privateKey) throw new Error('Internal error: no private key for a silent payment input');
        return { key: Buffer.from(keyPair.privateKey).toString('hex'), isXOnly };
      });

      outputs = resolveSilentPaymentTargets(
        outputs,
        inputs.map(u => ({ txid: u.txid, vout: u.vout })),
        inputPrivateKeys,
        network,
      ) as CoinSelectOutput[];
    }

    sequence = sequence || AbstractHDElectrumWallet.defaultRBFSequence;
    let psbt = new bitcoin.Psbt({ network });
    let c = 0;
    const keypairs: Record<number, ECPairInterface> = {};
    const values: Record<number, number> = {};

    inputs.forEach(input => {
      let keyPair;
      if (!skipSigning) {
        // skiping signing related stuff
        keyPair = ECPair.fromWIF(this._getWifForAddress(String(input.address)), network);
        keypairs[c] = keyPair;
      }
      values[c] = input.value;
      c++;
      if (!skipSigning) {
        // skiping signing related stuff
        if (!input.address || !this._getWifForAddress(input.address)) throw new Error('Internal error: no address or WIF to sign input');
      }

      let masterFingerprintBuffer;
      if (masterFingerprint) {
        let masterFingerprintHex = Number(masterFingerprint).toString(16);
        if (masterFingerprintHex.length < 8) masterFingerprintHex = '0' + masterFingerprintHex; // conversion without explicit zero might result in lost byte
        const hexBuffer = Buffer.from(masterFingerprintHex, 'hex');
        masterFingerprintBuffer = Buffer.from(hexBuffer).reverse();
      } else {
        masterFingerprintBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      }
      // this is not correct fingerprint, as we dont know real fingerprint - we got zpub with 84/0, but fingerpting
      // should be from root. basically, fingerprint should be provided from outside  by user when importing zpub

      psbt = this._addPsbtInput(psbt, input, sequence, masterFingerprintBuffer);
    });

    outputs.forEach(output => {
      let change = false;
      if (isChangeOutput(output)) {
        change = true;
        output.address = changeAddress;
      }

      const path = this._getDerivationPathByAddress(String(output.address));
      const pubkey = this._getPubkeyByAddress(String(output.address));
      let masterFingerprintBuffer;

      if (masterFingerprint) {
        let masterFingerprintHex = Number(masterFingerprint).toString(16);
        if (masterFingerprintHex.length < 8) masterFingerprintHex = '0' + masterFingerprintHex; // conversion without explicit zero might result in lost byte
        const hexBuffer = Buffer.from(masterFingerprintHex, 'hex');
        masterFingerprintBuffer = Buffer.from(hexBuffer).reverse();
      } else {
        masterFingerprintBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      }

      // this is not correct fingerprint, as we dont know realfingerprint - we got zpub with 84/0, but fingerpting
      // should be from root. basically, fingerprint should be provided from outside  by user when importing zpub

      psbt.addOutput({
        address: output.address,
        // @ts-ignore types from bitcoinjs are not exported so we cant define outputData separately and add fields conditionally (either address or script should be present)
        script: output.script?.hex ? Buffer.from(output.script.hex, 'hex') : undefined,
        value: BigInt(output.value),
        bip32Derivation:
          change && path && pubkey && this.segwitType !== 'p2tr'
            ? [
                {
                  masterFingerprint: masterFingerprintBuffer,
                  path,
                  pubkey,
                },
              ]
            : [],
        tapBip32Derivation:
          this.segwitType === 'p2tr' && pubkey && path && change
            ? [
                {
                  pubkey: new Uint8Array(pubkey),
                  masterFingerprint: new Uint8Array(masterFingerprintBuffer),
                  path,
                  leafHashes: [],
                },
              ]
            : [],
        ...(this.segwitType === 'p2tr' && pubkey ? { tapInternalKey: new Uint8Array(pubkey) } : {}),
      });
    });

    if (!skipSigning) {
      // skiping signing related stuff
      for (let cc = 0; cc < c; cc++) {
        if (this.segwitType === 'p2tr') {
          if (!psbt.data.inputs[cc].tapInternalKey) throw new Error('TapInternalKey is required for taproot inputs');
          psbt.signTaprootInput(
            cc,
            keypairs[cc].tweak(bitcoin.crypto.taggedHash('TapTweak', psbt.data.inputs[cc].tapInternalKey as Uint8Array)),
          );
        } else {
          psbt.signInput(cc, keypairs[cc]);
        }
      }
    }

    let tx;
    if (!skipSigning) {
      tx = psbt.finalizeAllInputs().extractTransaction();
    }
    return { tx, inputs, outputs, fee, psbt };
  }

  _addPsbtInput(psbt: Psbt, input: CoinSelectReturnInput, sequence: number, masterFingerprintBuffer: Buffer) {
    if (!input.address) {
      throw new Error('Internal error: no address on Utxo during _addPsbtInput()');
    }
    const pubkey = this._getPubkeyByAddress(input.address);
    const path = this._getDerivationPathByAddress(input.address);
    if (!pubkey || !path) {
      throw new Error('Internal error: pubkey or path are invalid');
    }
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network: this.getNetworkConfig().bitcoinjs });
    if (!p2wpkh.output) {
      throw new Error('Internal error: could not create p2wpkh output during _addPsbtInput');
    }

    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      sequence,
      bip32Derivation: [
        {
          masterFingerprint: masterFingerprintBuffer,
          path,
          pubkey,
        },
      ],
      witnessUtxo: {
        script: p2wpkh.output,
        value: BigInt(input.value),
      },
    });

    return psbt;
  }

  /**
   * Combines 2 PSBTs into final transaction from which you can
   * get HEX and broadcast
   *
   * @param base64one {string|Psbt}
   * @param base64two {string|Psbt}
   * @returns {Transaction}
   */
  combinePsbt(base64one: string | Psbt, base64two: string | Psbt) {
    const final1 = typeof base64one === 'string' ? bitcoin.Psbt.fromBase64(base64one) : base64one;
    const final2 = typeof base64two === 'string' ? bitcoin.Psbt.fromBase64(base64two) : base64two;
    final1.combine(final2);

    let extractedTransaction;
    try {
      extractedTransaction = final1.finalizeAllInputs().extractTransaction();
    } catch (_) {
      // probably already finalized
      extractedTransaction = final1.extractTransaction();
    }

    return extractedTransaction;
  }

  /**
   * Creates Segwit Bech32 Bitcoin address
   */
  _nodeToBech32SegwitAddress(hdNode: BIP32Interface): string {
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: hdNode.publicKey,
      network: this.getNetworkConfig().bitcoinjs,
    });

    if (!address) {
      throw new Error('Could not create address in _nodeToBech32SegwitAddress');
    }

    return address;
  }

  static _getTransactionsFromHistories(histories: Record<string, ElectrumHistory[]>) {
    const txs = [];
    for (const history of Object.values(histories)) {
      for (const tx of history) {
        txs.push(tx);
      }
    }
    return txs;
  }

  /**
   * Probes zero address in external hierarchy for transactions, if there are any returns TRUE.
   * Zero address is a pretty good indicator, since its a first one to fund the wallet.
   *
   * @returns {Promise<boolean>}
   */
  async wasEverUsed(): Promise<boolean> {
    const txs1 = await Electrum.getTransactionsByAddress(this._getExternalAddressByIndex(0));
    return txs1.length > 0;
  }

  /**
   * @inheritDoc
   */
  getAllExternalAddresses() {
    const ret = [];

    for (let c = 0; c < this.next_free_address_index + this.gap_limit; c++) {
      ret.push(this._getExternalAddressByIndex(c));
    }

    return ret;
  }

  /**
   * Check if address is a Change address. Needed for Coin control.
   *
   * @param address
   * @returns {Boolean} Either address is a change or not
   */
  addressIsChange(address: string) {
    for (let c = 0; c < this.next_free_change_address_index + 1; c++) {
      if (address === this._getInternalAddressByIndex(c)) return true;
    }
    return false;
  }

  calculateHowManySignaturesWeHaveFromPsbt(psbt: Psbt) {
    let sigsHave = 0;
    for (const inp of psbt.data.inputs) {
      if (inp.finalScriptSig || inp.finalScriptWitness || inp.partialSig) sigsHave++;
    }
    return sigsHave;
  }

  /**
   * @param seed {Buffer} Buffer object with seed
   * @returns {string} Hex string of fingerprint derived from mnemonics. Always has length of 8 chars and correct leading zeroes. All caps
   */
  static seedToFingerprint(seed: Buffer) {
    const root = bip32.fromSeed(seed);
    let hex = root.fingerprint.toString('hex');
    while (hex.length < 8) hex = '0' + hex; // leading zeroes
    return hex.toUpperCase();
  }

  /**
   * @returns {string} Hex string of fingerprint derived from wallet mnemonics. Always has length of 8 chars and correct leading zeroes
   */
  getMasterFingerprintHex() {
    if (this._fp) {
      return this._fp; // cache hit
    }

    const seed = this._getSeed();
    this._fp = AbstractHDElectrumWallet.seedToFingerprint(seed);
    return this._fp;
  }

  _hdNodeToAddress(hdNode: BIP32Interface): string {
    return this._nodeToBech32SegwitAddress(hdNode);
  }

  isAddressValid(address: string): boolean {
    const network = this.getNetworkConfig().bitcoinjs;
    try {
      // Rejects an address belonging to another chain: toOutputScript checks the bech32 HRP and
      // the base58 version bytes against this network.
      bitcoin.address.toOutputScript(address, network);

      if (!address.toLowerCase().startsWith(`${network.bech32}1`)) return true;
      const decoded = bitcoin.address.fromBech32(address);
      if (decoded.version === 0) return true;
      if (decoded.version === 1 && decoded.data.length !== 32) return false;
      if (decoded.version === 1 && !ecc.isPoint(Buffer.concat([Buffer.from([2]), decoded.data]))) return false;
      if (decoded.version > 1) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  async broadcastTx(txhex: string): Promise<boolean> {
    const broadcast = await Electrum.broadcastV2(txhex);
    console.log({ broadcast });
    if (broadcast.indexOf('successfully') !== -1) return true;
    return broadcast.length === 64; // return string is txid (precise length), so it was broadcasted ok
  }

  coinselect(
    utxos: CreateTransactionUtxo[],
    targets: CreateTransactionTarget[],
    feeRate: number,
  ): {
    inputs: CoinSelectReturnInput[];
    outputs: CoinSelectOutput[];
    fee: number;
  } {
    let algo = coinSelect;
    // if targets has output without a value, we want send MAX to it
    if (targets.some(i => !('value' in i))) {
      algo = coinSelectSplit as unknown as typeof coinSelect;
    }

    const _utxos = JSON.parse(JSON.stringify(utxos)) as CreateTransactionUtxo[];
    const _targets = JSON.parse(JSON.stringify(targets)) as CreateTransactionTarget[];

    // compensating for coinselect inability to deal with segwit inputs, and overriding script length for proper vbytes calculation
    for (const u of _utxos) {
      if (u.script?.length) {
        continue;
      }

      if (this.segwitType === 'p2wpkh') {
        u.script = { length: 27 };
      } else if (this.segwitType === 'p2sh(p2wpkh)') {
        u.script = { length: 50 };
      } else if (this.segwitType === 'p2tr') {
        u.script = { length: 17 };
      }
    }

    const network = this.getNetworkConfig().bitcoinjs;
    for (const t of _targets) {
      if (t.address?.toLowerCase().startsWith(`${network.bech32}1`)) {
        t.script = { length: bitcoin.address.toOutputScript(t.address, network).length + 3 };
      } else if (isSilentPaymentAddress(t.address, network)) {
        // a silent payment target is unwrapped into a P2TR output before broadcast, so size it
        // as one; the +3 is the same margin the bech32 branch above carries, for addresses that
        // take more bytes than coinselect anticipates by default.
        t.script = { length: P2TR_SCRIPT_LENGTH + 3 };
      }

      if (t.script?.hex) {
        t.script.length = t.script.hex.length / 2 - 4;
      }
    }

    const { inputs, outputs, fee } = algo(_utxos, _targets as CoinSelectTarget[], feeRate);

    if (!inputs || !outputs) {
      throw new Error('Not enough balance. Try sending smaller amount or decrease the fee.');
    }

    // coinselect sizes the change output it appends as P2PKH (a 25-byte script), but our change
    // goes to a P2TR address — every concrete wallet here is p2tr (HDTaprootWallet and its
    // subclass HDSilentPaymentsWallet). Left uncorrected, every spend that produces change pays
    // under the requested feeRate — 1.92 instead of 2. Take the difference out of the change
    // rather than out of the fee.
    const shortfall = Math.round(feeRate * (P2TR_SCRIPT_LENGTH - P2PKH_SCRIPT_LENGTH));
    const last = outputs[outputs.length - 1]; // coinselect appends its change output last
    const change = last && isChangeOutput(last) ? last : undefined;
    if (change) {
      // coinselect only adds change worth more than it costs to spend later; re-check that
      // after taking our share, so we never leave an unspendable dust output behind.
      if (change.value - shortfall > utils.dustThreshold({}, feeRate)) {
        change.value -= shortfall;
        return { inputs, outputs, fee: fee + shortfall };
      }
      return { inputs, outputs: outputs.slice(0, -1), fee: fee + change.value };
    }

    return { inputs, outputs, fee };
  }
}
