import BigNumber from 'bignumber.js';
import * as bitcoin from 'bitcoinjs-lib';
import { bech32, bech32m } from 'bech32';
import DefaultPreference from 'react-native-default-preference';
import RNFS from 'react-native-fs';
import Realm from 'realm';
import { sha256 as _sha256 } from '@noble/hashes/sha256';

import presentAlert from '../components/Alert';
import loc from '../loc';
import { GROUP_IO_SHROUD } from './currency';
import { DEFAULT_NETWORK_ID, getActiveNetwork, getActiveNetworkId, type NetworkId, type Peer } from './network';
import { uint8ArrayToHex } from './uint8array-extras/index';
import TorManager, { DEFAULT_SOCKS_HOST } from './torManager';
import { createSocksNet } from './socksSocket';

const ElectrumClient = require('electrum-client');
const net = require('net');
const tls = require('tls');

type Utxo = {
  height: number;
  value: number;
  address: string;
  txid: string;
  vout: number;
  wif?: string;
};

type ElectrumTransaction = {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: {
    txid: string;
    vout: number;
    scriptSig: { asm: string; hex: string };
    txinwitness: string[];
    sequence: number;
    addresses?: string[];
    value?: number;
  }[];
  vout: {
    value: number;
    n: number;
    scriptPubKey: {
      asm: string;
      hex: string;
      reqSigs: number;
      type: string;
      addresses: string[];
    };
  }[];
  blockhash: string;
  confirmations: number;
  time: number;
  blocktime: number;
};

type ElectrumTransactionWithHex = ElectrumTransaction & {
  hex: string;
};

const decodeOutputAddress = (scriptHex: string): string | false => {
  const network = getActiveNetwork().bitcoinjs;
  try {
    return bitcoin.address.fromOutputScript(Buffer.from(scriptHex, 'hex'), network);
  } catch (_) {}
  // Fallback: decode native segwit (P2WPKH, P2WSH, P2TR) manually when initEccLib hasn't been called
  try {
    const hrp = network.bech32;
    const buf = Buffer.from(scriptHex, 'hex');
    if (buf[0] === 0x51 && buf[1] === 0x20 && buf.length === 34) {
      // P2TR: OP_1 OP_PUSH32 <32-byte-key>
      const words = bech32m.toWords(buf.slice(2));
      return bech32m.encode(hrp, [1, ...words]);
    } else if (buf[0] === 0x00 && buf[1] === 0x14 && buf.length === 22) {
      // P2WPKH: OP_0 OP_PUSH20 <20-byte-hash>
      const words = bech32.toWords(buf.slice(2));
      return bech32.encode(hrp, [0, ...words]);
    } else if (buf[0] === 0x00 && buf[1] === 0x20 && buf.length === 34) {
      // P2WSH: OP_0 OP_PUSH32 <32-byte-hash>
      const words = bech32.toWords(buf.slice(2));
      return bech32.encode(hrp, [0, ...words]);
    }
  } catch (_) {}
  return false;
};

type MempoolTransaction = {
  height: 0;
  tx_hash: string;
  fee: number;
};

export type ElectrumServerItem = Peer;

export const formatServerAddress = (server: ElectrumServerItem): string =>
  server.ssl !== undefined ? `ssl://${server.host}:${server.ssl}` : `tcp://${server.host}:${server.tcp}`;

// Parses the `host:port:s` / `host:port:t` wire format used by the `setelectrumserver` deeplink
// (e.g. `shroud:setelectrumserver?server=electrum.example.com%3A443%3As`). Distinct from the
// `ssl://host:port` format the Network Settings custom-server input accepts.
export const parseElectrumServerString = (value: string): ElectrumServerItem | null => {
  const parts = value.split(':');
  if (parts.length !== 3) return null;
  const [host, portStr, protocol] = parts;
  const port = Number(portStr);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (protocol === 's') return { host, ssl: port };
  if (protocol === 't') return { host, tcp: port };
  return null;
};

// Base names of the user's preferred-server preference. Mainnet uses them as-is — that is where
// every install saved its server before multi-network support, so the existing value simply is
// the mainnet one and needs no migration. Other chains append their id (see `electrumPreferenceKeys`).
export const ELECTRUM_HOST = 'electrum_host';
export const ELECTRUM_TCP_PORT = 'electrum_tcp_port';
export const ELECTRUM_SSL_PORT = 'electrum_ssl_port';
const storageKey = 'ELECTRUM_PEERS';

/**
 * Fallback peers for the active chain. Empty where no public server has been verified: Electrum
 * only powers the regular-output branch — silent payments go through the indexer — and shipping
 * unverified hostnames would be worse than making the user enter one in the network settings.
 */
export const getHardcodedPeers = (): Peer[] => getActiveNetwork().electrumPeers;

/** May be undefined on a chain with no known public servers; callers must handle that. */
const getDefaultPeer = (): Peer | undefined => getHardcodedPeers()[0];

export const getSuggestedServers = (): Peer[] => getHardcodedPeers().map(peer => ({ ...peer }));

let mainClient: typeof ElectrumClient | undefined;
let mainConnected: boolean = false;
let wasConnectedAtLeastOnce: boolean = false;
let serverName: string | false = false;
let disableBatching: boolean = false;
let connectionAttempt: number = 0;
// Random start spreads load across the peer list. Never used as a raw index: the active chain (and
// so the list length) can change at runtime, so getCurrentPeer/getNextPeer reduce it modulo the
// current list, which is what keeps any seed safe.
const randomPeerIndex = (): number => Math.floor(Math.random() * 1000);
let currentPeerIndex = randomPeerIndex();
let latestBlock: { height: number; time: number } | { height: undefined; time: undefined } = { height: undefined, time: undefined };
const txhashHeightCache: Record<string, number> = {};
let _realm: Realm | undefined;

function bitcoinjs_crypto_sha256(buffer: Uint8Array): Buffer {
  return Buffer.from(_sha256(buffer));
}

async function _getRealm() {
  if (_realm) return _realm;

  const cacheFolderPath = RNFS.CachesDirectoryPath; // Path to cache folder
  const password = uint8ArrayToHex(bitcoinjs_crypto_sha256(Buffer.from('fyegjitkyf[eqjnc.lf')));
  const buf = Buffer.from(password + password, 'hex');
  const encryptionKey = Int8Array.from(buf);
  const path = `${cacheFolderPath}/electrumcache.realm`; // Use cache folder path

  const schema = [
    {
      name: 'Cache',
      primaryKey: 'cache_key',
      properties: {
        cache_key: { type: 'string', indexed: true },
        cache_value: 'string', // stringified json
      },
    },
  ];

  // @ts-ignore schema doesn't match Realm's schema type
  _realm = await Realm.open({
    schema,
    path,
    encryptionKey,
    excludeFromIcloudBackup: true,
  });

  return _realm;
}

/**
 * Preference keys holding the user's preferred server for a chain. A server is only meaningful on
 * the chain it serves: one global preference let a mainnet server answer for testnet4 (empty
 * scripthash results, test transactions broadcast to a mainnet node) and a signet server answer
 * for a real mainnet wallet.
 */
export const electrumPreferenceKeys = (id: NetworkId = getActiveNetworkId()): { host: string; tcp: string; ssl: string } => {
  const suffix = id === DEFAULT_NETWORK_ID ? '' : `_${id}`;
  return {
    host: `${ELECTRUM_HOST}${suffix}`,
    tcp: `${ELECTRUM_TCP_PORT}${suffix}`,
    ssl: `${ELECTRUM_SSL_PORT}${suffix}`,
  };
};

export const getPreferredServer = async (): Promise<ElectrumServerItem | undefined> => {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    const keys = electrumPreferenceKeys();
    const host = (await DefaultPreference.get(keys.host)) as string;
    const tcpPort = await DefaultPreference.get(keys.tcp);
    const sslPort = await DefaultPreference.get(keys.ssl);

    console.log('Getting preferred server:', { host, tcpPort, sslPort });

    if (!host) {
      console.warn('Preferred server host is undefined');
      return;
    }

    return {
      host,
      tcp: tcpPort ? Number(tcpPort) : undefined,
      ssl: sslPort ? Number(sslPort) : undefined,
    };
  } catch (error) {
    console.error('Error in getPreferredServer:', error);
    return undefined;
  }
};

function getCurrentPeer(): Peer | undefined {
  const peers = getHardcodedPeers();
  if (peers.length === 0) return undefined;
  return peers[currentPeerIndex % peers.length];
}

/**
 * Returns NEXT hardcoded electrum server (increments index after use), or undefined on a chain
 * that ships no fallback peers — in which case only a user-entered server can be used.
 */
function getNextPeer(): Peer | undefined {
  const peers = getHardcodedPeers();
  if (peers.length === 0) return undefined;
  const peer = getCurrentPeer();
  currentPeerIndex = (currentPeerIndex + 1) % peers.length;
  return peer;
}

async function getSavedPeer(): Promise<Peer | null> {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    const keys = electrumPreferenceKeys();
    const host = (await DefaultPreference.get(keys.host)) as string;
    const tcpPort = await DefaultPreference.get(keys.tcp);
    const sslPort = await DefaultPreference.get(keys.ssl);

    console.log('Getting saved peer:', { host, tcpPort, sslPort });

    if (!host) {
      return null;
    }

    if (sslPort) {
      return { host, ssl: Number(sslPort) };
    }

    if (tcpPort) {
      return { host, tcp: Number(tcpPort) };
    }

    return null;
  } catch (error) {
    console.error('Error in getSavedPeer:', error);
    return null;
  }
}

export async function connectMain(): Promise<void> {
  let usingPeer = getNextPeer();
  const savedPeer = await getSavedPeer();
  if (savedPeer && savedPeer.host && (savedPeer.tcp || savedPeer.ssl)) {
    usingPeer = savedPeer;
  }

  if (!usingPeer) {
    // No fallback peers for this chain and the user has not entered one. Silent payments do not
    // need Electrum, so this is a normal state on the test chains rather than an error.
    console.log(`No Electrum server available for ${getActiveNetwork().displayName}; skipping connectMain`);
    return;
  }

  console.log('Using peer:', JSON.stringify(usingPeer));

  try {
    console.log('begin connection:', JSON.stringify(usingPeer));
    const transport = await resolveElectrumTransport(usingPeer.host, usingPeer.tcp, usingPeer.ssl);
    if (!transport) {
      throw new Error(`Cannot connect to ${usingPeer.host}: onion servers require Tor to be enabled with a tcp port configured`);
    }
    mainClient = new ElectrumClient(transport.net, tls, transport.port, usingPeer.host, transport.protocol);

    mainClient.onError = function (e: { message: string }) {
      console.log('electrum mainClient.onError():', e.message);
      if (mainConnected) {
        // most likely got a timeout from electrum ping. lets reconnect
        // but only if we were previously connected (mainConnected), otherwise theres other
        // code which does connection retries
        mainClient?.close();
        mainClient = undefined;
        mainConnected = false;
        // dropping `mainConnected` flag ensures there wont be reconnection race condition if several
        // errors triggered
        console.log('reconnecting after socket error');
        setTimeout(connectMain, usingPeer.host.endsWith('.onion') ? 4000 : 500);
      }
    };
    const ver = await mainClient.initElectrum({ client: 'shroud', version: '1.4' });
    if (ver && ver[0]) {
      console.log('connected to ', ver);
      serverName = ver[0];
      mainConnected = true;
      wasConnectedAtLeastOnce = true;
      if (ver[0].startsWith('ElectrumPersonalServer') || ver[0].startsWith('electrs') || ver[0].startsWith('Fulcrum')) {
        disableBatching = true;

        // exeptions for versions:
        const [electrumImplementation, electrumVersion] = ver[0].split(' ');
        switch (electrumImplementation) {
          case 'electrs':
            if (semVerToInt(electrumVersion) >= semVerToInt('0.9.0')) {
              disableBatching = false;
            }
            break;
          case 'electrs-esplora':
            // its a different one, and it does NOT support batching
            // nop
            break;
          case 'Fulcrum':
            if (semVerToInt(electrumVersion) >= semVerToInt('1.9.0')) {
              disableBatching = false;
            }
            break;
        }
      }
      const header = await mainClient.blockchainHeaders_subscribe();
      if (header && header.height) {
        latestBlock = {
          height: header.height,
          time: Math.floor(+new Date() / 1000),
        };
      }
      // AsyncStorage.setItem(storageKey, JSON.stringify(peers));  TODO: refactor
    }
  } catch (e) {
    mainConnected = false;
    console.log('bad connection:', JSON.stringify(usingPeer), e);
    mainClient?.close();
    mainClient = undefined;
  }

  if (!mainConnected) {
    console.log('retry');
    connectionAttempt = connectionAttempt + 1;
    mainClient?.close();
    mainClient = undefined;
    if (connectionAttempt >= 5) {
      presentNetworkErrorAlert(usingPeer);
    } else {
      console.log('reconnection attempt #', connectionAttempt);
      await new Promise(resolve => setTimeout(resolve, 500)); // sleep
      return connectMain();
    }
  }
}

const presentNetworkErrorAlert = async (usingPeer?: Peer) => {
  presentAlert({
    allowRepeat: false,
    title: loc.errors.network,
    message: loc.formatString(
      usingPeer ? loc.settings.electrum_unable_to_connect : loc.settings.electrum_error_connect,
      usingPeer ? { server: `${usingPeer.host}:${usingPeer.ssl ?? usingPeer.tcp}` } : {},
    ),
    buttons: [
      {
        text: loc.wallets.list_tryagain,
        onPress: () => {
          connectionAttempt = 0;
          mainClient?.close();
          mainClient = undefined;
          setTimeout(connectMain, 500);
        },
        style: 'default',
      },
      {
        text: loc._.cancel,
        onPress: () => {
          connectionAttempt = 0;
          mainClient?.close();
          mainClient = undefined;
        },
        style: 'cancel',
      },
    ],
    options: { cancelable: false },
  });
};

/**
 * Returns random electrum server out of list of servers
 * previous electrum server told us. Nearly half of them is
 * usually offline.
 * Not used for now.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getRandomDynamicPeer(): Promise<Peer | undefined> {
  try {
    let peers = JSON.parse((await DefaultPreference.get(storageKey)) as string);
    peers = peers.sort(() => Math.random() - 0.5); // shuffle
    for (const peer of peers) {
      const ret: Peer = { host: peer[0], ssl: peer[1] };
      ret.host = peer[1];

      if (peer[1] === 's') {
        ret.ssl = peer[2];
      } else {
        ret.tcp = peer[2];
      }

      for (const item of peer[2]) {
        if (item.startsWith('t')) {
          ret.tcp = item.replace('t', '');
        }
      }
      if (ret.host && ret.tcp) return ret;
    }

    return getDefaultPeer(); // failed to find random client, using default
  } catch (_) {
    return getDefaultPeer(); // smth went wrong, using default
  }
}

export const getBalanceByAddress = async function (address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  try {
    if (!mainClient) throw new Error('Electrum client is not connected');
    const script = bitcoin.address.toOutputScript(address, getActiveNetwork().bitcoinjs);
    const hash = bitcoinjs_crypto_sha256(script);
    const reversedHash = Buffer.from(hash).reverse();
    const balance = await mainClient.blockchainScripthash_getBalance(reversedHash.toString('hex'));
    balance.addr = address;
    return balance;
  } catch (error) {
    console.error('Error in getBalanceByAddress:', error);
    throw error;
  }
};

export const getConfig = async function () {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return {
    host: mainClient.host,
    port: mainClient.port,
    serverName,
    connected: mainClient.timeLastCall !== 0 && mainClient.status,
  };
};

export const getTransactionsByAddress = async function (address: string): Promise<ElectrumHistory[]> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const script = bitcoin.address.toOutputScript(address, getActiveNetwork().bitcoinjs);
  const hash = bitcoinjs_crypto_sha256(script);
  const reversedHash = Buffer.from(hash).reverse();
  const history = await mainClient.blockchainScripthash_getHistory(reversedHash.toString('hex'));
  for (const h of history || []) {
    if (h.tx_hash) txhashHeightCache[h.tx_hash] = h.height; // cache tx height
  }

  return history;
};

export const getMempoolTransactionsByAddress = async function (address: string): Promise<MempoolTransaction[]> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const script = bitcoin.address.toOutputScript(address, getActiveNetwork().bitcoinjs);
  const hash = bitcoinjs_crypto_sha256(script);
  const reversedHash = Buffer.from(hash).reverse();
  return mainClient.blockchainScripthash_getMempool(reversedHash.toString('hex'));
};

export const ping = async function () {
  try {
    await mainClient.server_ping();
    return true;
  } catch (_) {}

  mainConnected = false;
  return false;
};

// exported only to be used in unit tests
export function txhexToElectrumTransaction(txhex: string): ElectrumTransactionWithHex {
  const tx = bitcoin.Transaction.fromHex(txhex);

  const ret: ElectrumTransactionWithHex = {
    txid: tx.getId(),
    hash: tx.getId(),
    version: tx.version,
    size: Math.ceil(txhex.length / 2),
    vsize: tx.virtualSize(),
    weight: tx.weight(),
    locktime: tx.locktime,
    vin: [],
    vout: [],
    hex: txhex,
    blockhash: '',
    confirmations: 0,
    time: 0,
    blocktime: 0,
  };

  if (txhashHeightCache[ret.txid]) {
    // got blockheight where this tx was confirmed
    ret.confirmations = estimateCurrentBlockheight() - txhashHeightCache[ret.txid];
    if (ret.confirmations < 0) {
      // ugly fix for when estimator lags behind
      ret.confirmations = 1;
    }
    ret.time = calculateBlockTime(txhashHeightCache[ret.txid]);
    ret.blocktime = calculateBlockTime(txhashHeightCache[ret.txid]);
  }

  for (const inn of tx.ins) {
    const txinwitness = [];
    if (inn.witness[0]) txinwitness.push(uint8ArrayToHex(inn.witness[0]));
    if (inn.witness[1]) txinwitness.push(uint8ArrayToHex(inn.witness[1]));

    ret.vin.push({
      txid: Buffer.from(inn.hash).reverse().toString('hex'),
      vout: inn.index,
      scriptSig: { hex: uint8ArrayToHex(inn.script), asm: '' },
      txinwitness,
      sequence: inn.sequence,
    });
  }

  let n = 0;
  for (const out of tx.outs) {
    const value = new BigNumber(out.value).dividedBy(100000000).toNumber();
    let address: false | string = false;
    let type = 'nonstandard';

    const scriptHex = uint8ArrayToHex(out.script);
    address = decodeOutputAddress(scriptHex);
    let legacyAddress: string | false = false;
    try {
      legacyAddress =
        bitcoin.payments.p2pkh({ output: Buffer.from(scriptHex, 'hex'), network: getActiveNetwork().bitcoinjs }).address ?? false;
    } catch (_) {}

    if (/^5120[0-9a-f]{64}$/i.test(scriptHex)) {
      type = 'witness_v1_taproot';
    } else if (/^0020[0-9a-f]{64}$/i.test(scriptHex)) {
      type = 'witness_v0_scripthash';
    } else if (/^0014[0-9a-f]{40}$/i.test(scriptHex)) {
      type = 'witness_v0_keyhash';
    } else if (/^a914[0-9a-f]{40}87$/i.test(scriptHex)) {
      type = 'scripthash';
    } else if (/^76a914[0-9a-f]{40}88ac$/i.test(scriptHex)) {
      type = 'pubkeyhash';
    }

    if (!address && legacyAddress) {
      address = legacyAddress;
    }

    if (!address) {
      throw new Error('Internal error: unable to decode address from output script');
    }

    ret.vout.push({
      value,
      n,
      scriptPubKey: {
        asm: '',
        hex: uint8ArrayToHex(out.script),
        reqSigs: 1, // todo
        type,
        addresses: [address],
      },
    });
    n++;
  }
  return ret;
}

export const getTransactionsFullByAddress = async (address: string): Promise<ElectrumTransaction[]> => {
  const txs = await getTransactionsByAddress(address);
  const ret: ElectrumTransaction[] = [];
  for (const tx of txs) {
    let full;
    try {
      full = await mainClient.blockchainTransaction_get(tx.tx_hash, true);
    } catch (error: any) {
      if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
        // apparently, stupid esplora instead of returning txhex when it cant return verbose tx started
        // throwing a proper exception. lets fetch txhex manually and decode on our end
        const txhex = await mainClient.blockchainTransaction_get(tx.tx_hash, false);
        full = txhexToElectrumTransaction(txhex);
      } else {
        // nope, its something else
        throw new Error(String(error?.message ?? error));
      }
    }
    full.address = address;
    for (const input of full.vin) {
      // now we need to fetch previous TX where this VIN became an output, so we can see its amount
      let prevTxForVin;
      try {
        prevTxForVin = await mainClient.blockchainTransaction_get(input.txid, true);
      } catch (error: any) {
        if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
          // apparently, stupid esplora instead of returning txhex when it cant return verbose tx started
          // throwing a proper exception. lets fetch txhex manually and decode on our end
          const txhex = await mainClient.blockchainTransaction_get(input.txid, false);
          prevTxForVin = txhexToElectrumTransaction(txhex);
        } else {
          // nope, its something else
          throw new Error(String(error?.message ?? error));
        }
      }
      if (prevTxForVin && prevTxForVin.vout && prevTxForVin.vout[input.vout]) {
        input.value = prevTxForVin.vout[input.vout].value;
        // also, we extract destination address from prev output:
        if (prevTxForVin.vout[input.vout].scriptPubKey && prevTxForVin.vout[input.vout].scriptPubKey.addresses) {
          input.addresses = prevTxForVin.vout[input.vout].scriptPubKey.addresses;
        }
        // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
        if (prevTxForVin.vout[input.vout]?.scriptPubKey?.address) {
          input.addresses = [prevTxForVin.vout[input.vout].scriptPubKey.address];
        }
      }
    }

    for (const output of full.vout) {
      if (output?.scriptPubKey && output.scriptPubKey.addresses) output.addresses = output.scriptPubKey.addresses;
      // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
      if (output?.scriptPubKey?.address) output.addresses = [output.scriptPubKey.address];
    }
    full.inputs = full.vin;
    full.outputs = full.vout;
    delete full.vin;
    delete full.vout;
    delete full.hex; // compact
    delete full.hash; // compact
    ret.push(full);
  }

  return ret;
};

type MultiGetBalanceResponse = {
  balance: number;
  unconfirmed_balance: number;
  addresses: Record<string, { confirmed: number; unconfirmed: number }>;
};

export const multiGetBalanceByAddress = async (addresses: string[], batchsize: number = 200): Promise<MultiGetBalanceResponse> => {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret = {
    balance: 0,
    unconfirmed_balance: 0,
    addresses: {} as Record<string, { confirmed: number; unconfirmed: number }>,
  };

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr, getActiveNetwork().bitcoinjs);
      const hash = bitcoinjs_crypto_sha256(script);
      const reversedHash = Buffer.from(hash).reverse().toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let balances = [];

    if (disableBatching) {
      const promises = [];
      const index2scripthash: Record<number, string> = {};
      for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
        promises.push(mainClient.blockchainScripthash_getBalance(scripthashes[promiseIndex]));
        index2scripthash[promiseIndex] = scripthashes[promiseIndex];
      }
      const promiseResults = await Promise.all(promises);
      for (let resultIndex = 0; resultIndex < promiseResults.length; resultIndex++) {
        balances.push({ result: promiseResults[resultIndex], param: index2scripthash[resultIndex] });
      }
    } else {
      balances = await mainClient.blockchainScripthash_getBalanceBatch(scripthashes);
    }

    for (const bal of balances) {
      if (bal.error) console.warn('multiGetBalanceByAddress():', bal.error);
      ret.balance += +bal.result.confirmed;
      ret.unconfirmed_balance += +bal.result.unconfirmed;
      ret.addresses[scripthash2addr[bal.param]] = bal.result;
    }
  }

  return ret;
};

export const multiGetUtxoByAddress = async function (addresses: string[], batchsize: number = 100): Promise<Record<string, Utxo[]>> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: Record<string, any> = {};

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr, getActiveNetwork().bitcoinjs);
      const hash = bitcoinjs_crypto_sha256(script);
      const reversedHash = Buffer.from(hash).reverse().toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let results = [];

    if (disableBatching) {
      // ElectrumPersonalServer doesnt support `blockchain.scripthash.listunspent`
      // electrs OTOH supports it, but we dont know it we are currently connected to it or to EPS
      // so it is pretty safe to do nothing, as caller can derive UTXO from stored transactions
    } else {
      results = await mainClient.blockchainScripthash_listunspentBatch(scripthashes);
    }

    for (const utxos of results) {
      ret[scripthash2addr[utxos.param]] = utxos.result;
      for (const utxo of ret[scripthash2addr[utxos.param]]) {
        utxo.address = scripthash2addr[utxos.param];
        utxo.txid = utxo.tx_hash;
        utxo.vout = utxo.tx_pos;
        delete utxo.tx_pos;
        delete utxo.tx_hash;
      }
    }
  }

  return ret;
};

export type ElectrumHistory = {
  tx_hash: string;
  height: number;
  address: string;
};

export const multiGetHistoryByAddress = async function (
  addresses: string[],
  batchsize: number = 100,
): Promise<Record<string, ElectrumHistory[]>> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: Record<string, ElectrumHistory[]> = {};

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr, getActiveNetwork().bitcoinjs);
      const hash = bitcoinjs_crypto_sha256(script);
      const reversedHash = Buffer.from(hash).reverse().toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let results = [];

    if (disableBatching) {
      const promises = [];
      const index2scripthash: Record<number, string> = {};
      for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
        index2scripthash[promiseIndex] = scripthashes[promiseIndex];
        promises.push(mainClient.blockchainScripthash_getHistory(scripthashes[promiseIndex]));
      }
      const histories = await Promise.all(promises);
      for (let historyIndex = 0; historyIndex < histories.length; historyIndex++) {
        results.push({ result: histories[historyIndex], param: index2scripthash[historyIndex] });
      }
    } else {
      results = await mainClient.blockchainScripthash_getHistoryBatch(scripthashes);
    }

    for (const history of results) {
      if (history.error) console.warn('multiGetHistoryByAddress():', history.error);
      ret[scripthash2addr[history.param]] = history.result || [];
      for (const result of history.result || []) {
        if (result.tx_hash) txhashHeightCache[result.tx_hash] = result.height; // cache tx height
      }

      for (const hist of ret[scripthash2addr[history.param]]) {
        hist.address = scripthash2addr[history.param];
      }
    }
  }

  return ret;
};

// if verbose === true ? Record<string, ElectrumTransaction> : Record<string, string>
type MultiGetTransactionByTxidResult<T extends boolean> = T extends true ? Record<string, ElectrumTransaction> : Record<string, string>;

// TODO: this function returns different results based on the value of `verboseParam`, consider splitting it into two
export async function multiGetTransactionByTxid<T extends boolean>(
  txids: string[],
  verbose: T,
  batchsize: number = 45,
): Promise<MultiGetTransactionByTxidResult<T>> {
  txids = txids.filter(txid => !!txid); // failsafe: removing 'undefined' or other falsy stuff from txids array
  // this value is fine-tuned so althrough wallets in test suite will occasionally
  // throw 'response too large (over 1,000,000 bytes', test suite will pass
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: MultiGetTransactionByTxidResult<T> = {};
  txids = [...new Set(txids)]; // deduplicate just for any case

  // lets try cache first:
  const realm = await _getRealm();
  const cacheKeySuffix = verbose ? '_verbose' : '_non_verbose';
  const keysCacheMiss = [];
  for (const txid of txids) {
    const jsonString = realm.objectForPrimaryKey('Cache', txid + cacheKeySuffix); // search for a realm object with a primary key
    if (jsonString && jsonString.cache_value) {
      try {
        ret[txid] = JSON.parse(jsonString.cache_value as string);
      } catch (error) {
        console.log(error, 'cache failed to parse', jsonString.cache_value);
      }
    }

    if (!ret[txid]) keysCacheMiss.push(txid);
  }

  if (keysCacheMiss.length === 0) {
    return ret;
  }

  txids = keysCacheMiss;
  // end cache

  const chunks = splitIntoChunks(txids, batchsize);
  for (const chunk of chunks) {
    let results = [];

    if (disableBatching) {
      try {
        // in case of ElectrumPersonalServer it might not track some transactions (like source transactions for our transactions)
        // so we wrap it in try-catch. note, when `Promise.all` fails we will get _zero_ results, but we have a fallback for that
        const promises = [];
        const index2txid: Record<number, string> = {};
        for (let promiseIndex = 0; promiseIndex < chunk.length; promiseIndex++) {
          const txid = chunk[promiseIndex];
          index2txid[promiseIndex] = txid;
          promises.push(mainClient.blockchainTransaction_get(txid, verbose));
        }

        const transactionResults = await Promise.all(promises);
        for (let resultIndex = 0; resultIndex < transactionResults.length; resultIndex++) {
          let tx = transactionResults[resultIndex];
          if (typeof tx === 'string' && verbose) {
            // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
            // lets decode it manually on our end then:
            tx = txhexToElectrumTransaction(tx);
          }
          const txid = index2txid[resultIndex];
          results.push({ result: tx, param: txid });
        }
      } catch (error: any) {
        if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
          // electrs-esplora. cant use verbose, so fetching txs one by one and decoding locally
          for (const txid of chunk) {
            try {
              let tx = await mainClient.blockchainTransaction_get(txid, false);
              tx = txhexToElectrumTransaction(tx);
              results.push({ result: tx, param: txid });
            } catch (err) {
              console.log(err);
            }
          }
        } else {
          // fallback. pretty sure we are connected to EPS.  we try getting transactions one-by-one. this way we wont
          // fail and only non-tracked by EPS transactions will be omitted
          for (const txid of chunk) {
            try {
              let tx = await mainClient.blockchainTransaction_get(txid, verbose);
              if (typeof tx === 'string' && verbose) {
                // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
                // lets decode it manually on our end then:
                tx = txhexToElectrumTransaction(tx);
              }
              results.push({ result: tx, param: txid });
            } catch (err) {
              console.log(err);
            }
          }
        }
      }
    } else {
      results = await mainClient.blockchainTransaction_getBatch(chunk, verbose);
    }

    for (const txdata of results) {
      if (txdata.error && txdata.error.code === -32600) {
        // response too large
        // lets do single call, that should go through okay:
        txdata.result = await mainClient.blockchainTransaction_get(txdata.param, false);
        // since we used VERBOSE=false, server sent us plain txhex which we must decode on our end:
        txdata.result = txhexToElectrumTransaction(txdata.result);
      }
      ret[txdata.param] = txdata.result;
      // @ts-ignore: hex property
      if (ret[txdata.param]) delete ret[txdata.param].hex; // compact
    }
  }

  // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
  for (const txid of Object.keys(ret)) {
    const tx = ret[txid];
    if (typeof tx === 'string') continue;
    for (const vout of tx?.vout ?? []) {
      // @ts-ignore: address is not in type definition
      if (vout?.scriptPubKey?.address) vout.scriptPubKey.addresses = [vout.scriptPubKey.address];
    }
  }

  // saving cache:
  try {
    realm.write(() => {
      for (const txid of Object.keys(ret)) {
        const tx = ret[txid];
        // dont cache immature txs, but only for 'verbose', since its fully decoded tx jsons. non-verbose are just plain
        // strings txhex
        if (verbose && typeof tx !== 'string' && (!tx?.confirmations || tx.confirmations < 7)) {
          continue;
        }

        realm.create(
          'Cache',
          {
            cache_key: txid + cacheKeySuffix,
            cache_value: JSON.stringify(ret[txid]),
          },
          Realm.UpdateMode.Modified,
        );
      }
    });
  } catch (writeError) {
    console.error('Failed to write transaction cache:', writeError);
  }

  return ret;
}

/**
 * Simple waiter till `mainConnected` becomes true (which means
 * it Electrum was connected in other function), or timeout 30 sec.
 */
export const waitTillConnected = async function (): Promise<boolean> {
  let waitTillConnectedInterval: NodeJS.Timeout | undefined;
  let retriesCounter = 0;
  return new Promise(function (resolve, reject) {
    waitTillConnectedInterval = setInterval(() => {
      if (mainConnected) {
        clearInterval(waitTillConnectedInterval);
        return resolve(true);
      }

      if (wasConnectedAtLeastOnce && retriesCounter++ >= 150) {
        // `wasConnectedAtLeastOnce` needed otherwise theres gona be a race condition with the code that connects
        // electrum during app startup
        clearInterval(waitTillConnectedInterval);
        presentNetworkErrorAlert();
        reject(new Error('Waiting for Electrum connection timeout'));
      }
    }, 100);
  });
};

// Returns the value at a given percentile in a sorted numeric array.
// "Linear interpolation between closest ranks" method
function percentile(arr: number[], p: number) {
  if (arr.length === 0) return 0;
  if (typeof p !== 'number') throw new TypeError('p must be a number');
  if (p <= 0) return arr[0];
  if (p >= 1) return arr[arr.length - 1];

  const index = (arr.length - 1) * p;
  const lower = Math.floor(index);
  const upper = lower + 1;
  const weight = index % 1;

  if (upper >= arr.length) return arr[lower];
  return arr[lower] * (1 - weight) + arr[upper] * weight;
}

/**
 * The histogram is an array of [fee, vsize] pairs, where vsizen is the cumulative virtual size of mempool transactions
 * with a fee rate in the interval [feen-1, feen], and feen-1 > feen.
 */
export const calcEstimateFeeFromFeeHistorgam = function (numberOfBlocks: number, feeHistorgram: number[][]) {
  // first, transforming histogram:
  let totalVsize = 0;
  const histogramToUse = [];
  for (const h of feeHistorgram) {
    let [fee, vsize] = h;
    let timeToStop = false;

    if (totalVsize + vsize >= 1000000 * numberOfBlocks) {
      vsize = 1000000 * numberOfBlocks - totalVsize; // only the difference between current summarized sige to tip of the block
      timeToStop = true;
    }

    histogramToUse.push({ fee, vsize });
    totalVsize += vsize;
    if (timeToStop) break;
  }

  // now we have histogram of precisely size for numberOfBlocks.
  // lets spread it into flat array so its easier to calculate percentile:
  let histogramFlat: number[] = [];
  for (const hh of histogramToUse) {
    histogramFlat = histogramFlat.concat(Array(Math.round(hh.vsize / 25000)).fill(hh.fee));
    // division is needed so resulting flat array is not too huge
  }

  histogramFlat = histogramFlat.sort(function (a, b) {
    return a - b;
  });

  return Math.round(percentile(histogramFlat, 0.5) || 1);
};

export const estimateFees = async function (): Promise<{ fast: number; medium: number; slow: number }> {
  let histogram;
  let timeoutId;
  try {
    histogram = await Promise.race([
      mainClient.mempool_getFeeHistogram(),
      new Promise(resolve => (timeoutId = setTimeout(resolve, 15000))),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }

  // fetching what electrum (which uses bitcoin core) thinks about fees:
  const _fast = await estimateFee(1);
  const _medium = await estimateFee(18);
  const _slow = await estimateFee(144);

  /**
   * sanity check, see
   * @see https://github.com/cculianu/Fulcrum/issues/197
   * (fallback to bitcoin core estimates)
   */
  if (!histogram || histogram?.[0]?.[0] > 1000) return { fast: _fast, medium: _medium, slow: _slow };

  // calculating fast fees from mempool:
  const fast = Math.max(2, calcEstimateFeeFromFeeHistorgam(1, histogram));
  // recalculating medium and slow fees using bitcoincore estimations only like relative weights:
  // (minimum 1 sat, just for any case)
  const medium = Math.max(1, Math.round((fast * _medium) / _fast));
  const slow = Math.max(1, Math.round((fast * _slow) / _fast));
  return { fast, medium, slow };
};

/**
 * Returns the estimated transaction fee to be confirmed within a certain number of blocks
 *
 * @param numberOfBlocks {number} The number of blocks to target for confirmation
 * @returns {Promise<number>} Satoshis per byte
 */
export const estimateFee = async function (numberOfBlocks: number): Promise<number> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  numberOfBlocks = numberOfBlocks || 1;
  const coinUnitsPerKilobyte = await mainClient.blockchainEstimatefee(numberOfBlocks);
  if (coinUnitsPerKilobyte === -1) return 1;
  return Math.round(new BigNumber(coinUnitsPerKilobyte).dividedBy(1024).multipliedBy(100000000).toNumber());
};

export const serverFeatures = async function () {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return mainClient.server_features();
};

export const broadcastV2 = async function (hex: string): Promise<string> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return mainClient.blockchainTransaction_broadcast(hex);
};

export const estimateCurrentBlockheight = function (): number {
  if (latestBlock.height) {
    const timeDiff = Math.floor(+new Date() / 1000) - latestBlock.time;
    const extraBlocks = Math.floor(timeDiff / (9.93 * 60));
    return latestBlock.height + extraBlocks;
  }

  const baseTs = 1587570465609; // uS
  const baseHeight = 627179;
  return Math.floor(baseHeight + (+new Date() - baseTs) / 1000 / 60 / 9.93);
};

const calculateBlockTime = function (height: number): number {
  if (latestBlock.height) {
    return Math.floor(latestBlock.time + (height - latestBlock.height) * 9.93 * 60);
  }

  const baseTs = 1585837504; // sec
  const baseHeight = 624083;
  return Math.floor(baseTs + (height - baseHeight) * 9.93 * 60);
};

interface ElectrumTransport {
  net: typeof net;
  protocol: 'tcp' | 'tls';
  port: number;
}

/**
 * Picks the net module + protocol + port an ElectrumClient should be constructed with for a
 * given host. For .onion hosts, routes through the user's configured SOCKS5 proxy (Orbot)
 * instead of dialing directly - .onion hosts have no DNS record and are only reachable through
 * Tor. Returns null when the host can't be reached at all: no port configured, or - for .onion -
 * no tcp port configured or Tor not enabled. TLS is not supported for .onion hosts (see
 * socksSocket.ts - react-native-tcp-socket's TLSSocket needs a real native socket underneath,
 * which the SOCKS5 tunnel wrapper isn't; onion Electrum servers are also typically plaintext
 * already, since Tor provides transport encryption itself).
 */
const resolveElectrumTransport = async (host: string, tcpPort?: number, sslPort?: number): Promise<ElectrumTransport | null> => {
  if (!host.endsWith('.onion')) {
    const port = sslPort || tcpPort;
    if (!port) return null;
    return { net, protocol: sslPort ? 'tls' : 'tcp', port };
  }

  if (!tcpPort) return null;

  const torManager = TorManager.getInstance();
  await torManager.ensureLoaded();
  if (!torManager.settings.enabled) return null;

  return { net: createSocksNet(DEFAULT_SOCKS_HOST, torManager.socksPort), protocol: 'tcp', port: tcpPort };
};

/**
 * @returns {Promise<boolean>} Whether provided host:port is a valid electrum server
 */
export const testConnection = async function (host: string, tcpPort?: number, sslPort?: number): Promise<boolean> {
  const transport = await resolveElectrumTransport(host, tcpPort, sslPort);
  if (!transport) return false;

  const client = new ElectrumClient(transport.net, tls, transport.port, host, transport.protocol);

  client.onError = () => {}; // mute
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    const rez = await Promise.race([
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve('timeout'), 5000);
      }),
      client.connect(),
    ]);
    if (rez === 'timeout') return false;

    await client.server_version('2.7.11', '1.4');
    await client.server_ping();
    return true;
  } catch (_) {
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    client.close();
  }

  return false;
};

export const forceDisconnect = (): void => {
  mainClient?.close();
};

/**
 * Drop everything learned from the chain we are leaving. `forceDisconnect` only closes the
 * socket, which leaves `mainClient` defined, `mainConnected` true and `latestBlock` holding the
 * old tip — so on the new chain the block-height estimates are wrong and, when it has no peer,
 * every `if (!mainClient)` guard passes against a dead client instead of reporting "not connected".
 */
export const resetForNetworkSwitch = (): void => {
  // Cleared first: `onError` reconnects when it sees `mainConnected`, and closing the socket can
  // raise it. A reconnect here would race the switch.
  mainConnected = false;
  const outgoing = mainClient;
  mainClient = undefined;
  serverName = false;
  disableBatching = false;
  latestBlock = { height: undefined, time: undefined };
  currentPeerIndex = randomPeerIndex();
  try {
    outgoing?.close();
  } catch (e) {
    console.warn('Error closing Electrum during a network switch:', e);
  }
};

export const setBatchingDisabled = () => {
  disableBatching = true;
};

export const setBatchingEnabled = () => {
  disableBatching = false;
};

const splitIntoChunks = function (arr: any[], chunkSize: number) {
  const groups = [];
  let i;
  for (i = 0; i < arr.length; i += chunkSize) {
    groups.push(arr.slice(i, i + chunkSize));
  }
  return groups;
};

const semVerToInt = function (semver: string): number {
  if (!semver) return 0;
  if (semver.split('.').length !== 3) return 0;

  const ret = Number(semver.split('.')[0]) * 1000000 + Number(semver.split('.')[1]) * 1000 + Number(semver.split('.')[2]) * 1;

  if (isNaN(ret)) return 0;

  return ret;
};
