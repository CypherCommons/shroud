import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha256';
import DefaultPreference from 'react-native-default-preference';
import RNFS from 'react-native-fs';
import Keychain from 'react-native-keychain';
import RNSecureKeyStore, { ACCESSIBLE } from 'react-native-secure-key-store';
import Realm from 'realm';

import * as encryption from '../modules/encryption';
import { GROUP_IO_SHROUD } from '../modules/currency';
import presentAlert from '../components/Alert';
import { randomBytes } from './rng';
import { ExtendedTransaction, Transaction, TWallet } from './wallets/types';
import { HDSilentPaymentsWallet } from './wallets/hd-bip352-wallet.ts';
import { readContacts, TContacts } from './contacts';
import { getActiveNetworkId, type NetworkId } from '../modules/network';
import { normaliseStoredNetworkId } from './wallets/abstract-wallet';

let usedBucketNum: boolean | number = false;
let savingInProgress = 0; // its both a flag and a counter of attempts to write to disk

export type TTXMetadata = {
  [txid: string]: {
    memo?: string;
  };
};

type TRealmTransaction = {
  internal: boolean;
  index: number;
  tx: string;
};

// A passphrase wallet as it was read from storage. It stays serialized until the user enters the
// passphrase, since without it no key or ID can be derived.
type TLockedWallet = {
  networkId: NetworkId;
  fingerprint: string;
  blob: string;
};

type TBucketStorage = {
  wallets: string[]; // array of serialized wallets, not actual wallet objects
  // Created wallets whose backup isn't finished yet, at most one per chain. Absent in older buckets.
  pendingWallets?: string[];
  tx_metadata: TTXMetadata;
  contacts: TContacts;
};

const isReactNative = typeof navigator !== 'undefined' && navigator?.product === 'ReactNative';

export class ShroudApp {
  static FLAG_ENCRYPTED = 'data_encrypted';
  static DO_NOT_TRACK = 'donottrack';

  private static _instance: ShroudApp | null = null;

  static keys2migrate = [ShroudApp.DO_NOT_TRACK];

  public cachedPassword?: false | string;
  public tx_metadata: TTXMetadata;
  public wallets: TWallet[];
  public lockedWallets: TLockedWallet[];
  // Saved so that a restart during backup brings back the same words; never in `wallets`, and
  // never with a passphrase, which is only applied when the wallet is committed.
  public pendingWallets: TWallet[];
  public contacts: TContacts;

  constructor() {
    this.wallets = [];
    this.lockedWallets = [];
    this.pendingWallets = [];
    this.tx_metadata = {};
    this.contacts = {};
    this.cachedPassword = false;
  }

  static getInstance(): ShroudApp {
    if (!ShroudApp._instance) {
      ShroudApp._instance = new ShroudApp();
    }

    return ShroudApp._instance;
  }

  async migrateKeys() {
    // do not migrate keys if we are not in RN env
    if (!isReactNative) {
      return;
    }

    for (const key of ShroudApp.keys2migrate) {
      try {
        const value = await RNSecureKeyStore.get(key);
        if (value) {
          await AsyncStorage.setItem(key, value);
          await RNSecureKeyStore.remove(key);
        }
      } catch (_) {}
    }
  }

  /**
   * Wrapper for storage call. Secure store works only in RN environment. AsyncStorage is
   * used for cli/tests
   */
  setItem = (key: string, value: any): Promise<any> => {
    if (isReactNative) {
      return RNSecureKeyStore.set(key, value, { accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    } else {
      return AsyncStorage.setItem(key, value);
    }
  };

  /**
   * Wrapper for storage call. Secure store works only in RN environment. AsyncStorage is
   * used for cli/tests
   */
  getItem = (key: string): Promise<any> => {
    if (isReactNative) {
      return RNSecureKeyStore.get(key);
    } else {
      return AsyncStorage.getItem(key);
    }
  };

  getItemWithFallbackToRealm = async (key: string): Promise<any | null> => {
    let value;
    try {
      return await this.getItem(key);
    } catch (error: any) {
      console.warn('error reading', key, error.message);
      console.warn('fallback to realm');
      const realmKeyValue = await this.openRealmKeyValue();
      const obj = realmKeyValue.objectForPrimaryKey('KeyValue', key); // search for a realm object with a primary key
      value = obj?.value;
      realmKeyValue.close();
      if (value) {
        // @ts-ignore value.length
        console.warn('successfully recovered', value.length, 'bytes from realm for key', key);
        return value;
      }
      return null;
    }
  };

  storageIsEncrypted = async (): Promise<boolean> => {
    let data;
    try {
      data = await this.getItemWithFallbackToRealm(ShroudApp.FLAG_ENCRYPTED);
    } catch (error: any) {
      console.warn('error reading `' + ShroudApp.FLAG_ENCRYPTED + '` key:', error.message);
      return false;
    }

    return Boolean(data);
  };

  isPasswordInUse = async (password: string) => {
    try {
      let data = await this.getItem('data');
      data = this.decryptData(data, password);
      return Boolean(data);
    } catch (_e) {
      return false;
    }
  };

  /**
   * Iterates through all values of `data` trying to
   * decrypt each one, and returns first one successfully decrypted
   */
  decryptData(data: string, password: string): boolean | string {
    data = JSON.parse(data);
    let decrypted;
    let num = 0;
    for (const value of data) {
      decrypted = encryption.decrypt(value, password);

      if (decrypted) {
        usedBucketNum = num;
        return decrypted;
      }
      num++;
    }

    return false;
  }

  decryptStorage = async (password: string): Promise<boolean> => {
    if (password === this.cachedPassword) {
      this.cachedPassword = undefined;
      await this.saveToDisk();
      // Open passphrase wallets stay open: the reload can't reopen them without the passphrase, and
      // it skips their stored copies because they're already here.
      this.wallets = this.wallets.filter(w => w.passphraseFingerprint);
      this.lockedWallets = [];
      this.pendingWallets = [];
      this.tx_metadata = {};
      this.contacts = {};
      return this.loadFromDisk();
    } else {
      throw new Error('Incorrect password. Please, try again.');
    }
  };

  encryptStorage = async (password: string): Promise<void> => {
    // assuming the storage is not yet encrypted
    await this.saveToDisk();
    let data = await this.getItem('data');
    // TODO: refactor ^^^ (should not save & load to fetch data)

    const encrypted = encryption.encrypt(data, password);
    data = [];
    data.push(encrypted); // putting in array as we might have many buckets with storages
    data = JSON.stringify(data);
    this.cachedPassword = password;
    await this.setItem('data', data);
    await this.setItem(ShroudApp.FLAG_ENCRYPTED, '1');
  };

  /**
   * Cleans up all current application data (wallets, tx metadata etc)
   * Encrypts the bucket and saves it storage
   */
  createFakeStorage = async (fakePassword: string): Promise<boolean> => {
    usedBucketNum = false; // resetting currently used bucket so we wont overwrite it
    this.wallets = [];
    this.lockedWallets = [];
    this.pendingWallets = [];
    this.tx_metadata = {};
    this.contacts = {};

    const data: TBucketStorage = {
      wallets: [],
      tx_metadata: {},
      contacts: {},
    };

    let buckets = await this.getItem('data');
    buckets = JSON.parse(buckets);
    buckets.push(encryption.encrypt(JSON.stringify(data), fakePassword));
    this.cachedPassword = fakePassword;
    const bucketsString = JSON.stringify(buckets);
    await this.setItem('data', bucketsString);
    return (await this.getItem('data')) === bucketsString;
  };

  hashIt = (s: string): string => {
    return Buffer.from(sha256(s)).toString('hex');
  };

  /**
   * Returns instace of the Realm database, which is encrypted either by cached user's password OR default password.
   * Database file is deterministically derived from encryption key.
   */
  async getRealmForTransactions() {
    const cacheFolderPath = RNFS.CachesDirectoryPath; // Path to cache folder
    const password = this.hashIt(this.cachedPassword || 'fyegjitkyf[eqjnc.lf');
    const buf = Buffer.from(this.hashIt(password) + this.hashIt(password), 'hex');
    const encryptionKey = Int8Array.from(buf);
    const fileName = this.hashIt(this.hashIt(password)) + '-wallettransactions.realm';
    const path = `${cacheFolderPath}/${fileName}`; // Use cache folder path

    const schema = [
      {
        name: 'WalletTransactions',
        properties: {
          walletid: { type: 'string', indexed: true },
          internal: 'bool?', // true - internal, false - external
          index: 'int?',
          tx: 'string', // stringified json
        },
      },
    ];
    // @ts-ignore schema doesn't match Realm's schema type
    return Realm.open({
      // @ts-ignore schema doesn't match Realm's schema type
      schema,
      path,
      encryptionKey,
      excludeFromIcloudBackup: true,
    });
  }

  /**
   * Returns instace of the Realm database, which is encrypted by random bytes stored in keychain.
   * Database file is static.
   *
   * @returns {Promise<Realm>}
   */
  async openRealmKeyValue(): Promise<Realm> {
    const cacheFolderPath = RNFS.CachesDirectoryPath; // Path to cache folder
    const service = 'realm_encryption_key';
    let password;
    const credentials = await Keychain.getGenericPassword({ service });
    if (credentials) {
      password = credentials.password;
    } else {
      const buf = await randomBytes(64);
      password = buf.toString('hex');
      await Keychain.setGenericPassword(service, password, { service });
    }

    const buf = Buffer.from(password, 'hex');
    const encryptionKey = Int8Array.from(buf);
    const path = `${cacheFolderPath}/keyvalue.realm`; // Use cache folder path

    const schema = [
      {
        name: 'KeyValue',
        primaryKey: 'key',
        properties: {
          key: { type: 'string', indexed: true },
          value: 'string', // stringified json, or whatever
        },
      },
    ];
    // @ts-ignore schema doesn't match Realm's schema type
    return Realm.open({
      // @ts-ignore schema doesn't match Realm's schema type
      schema,
      path,
      encryptionKey,
      excludeFromIcloudBackup: true,
    });
  }

  saveToRealmKeyValue(realmkeyValue: Realm, key: string, value: any) {
    realmkeyValue.write(() => {
      realmkeyValue.create(
        'KeyValue',
        {
          key,
          value,
        },
        Realm.UpdateMode.Modified,
      );
    });
  }

  /**
   * Loads from storage all wallets and
   * maps them to `this.wallets`
   *
   * @param password If present means storage must be decrypted before usage
   * @returns {Promise.<boolean>}
   */
  async loadFromDisk(password?: string): Promise<boolean> {
    // Wrap inside a try so if anything goes wrong it wont block loadFromDisk from continuing
    try {
      await this.moveRealmFilesToCacheDirectory();
    } catch (error: any) {
      console.warn('moveRealmFilesToCacheDirectory error:', error.message);
    }
    let dataRaw = await this.getItemWithFallbackToRealm('data');
    if (password) {
      dataRaw = this.decryptData(dataRaw, password);
      if (dataRaw) {
        // password is good, cache it
        this.cachedPassword = password;
      }
    }
    if (dataRaw !== null) {
      let realm;
      try {
        realm = await this.getRealmForTransactions();
      } catch (error: any) {
        presentAlert({ message: error.message });
      }
      const data: TBucketStorage = JSON.parse(dataRaw);
      if (!data.wallets) return false;
      this.tx_metadata = data.tx_metadata;
      this.contacts = readContacts(data.contacts);
      const wallets = data.wallets;
      for (const key of wallets) {
        let parsedWallet: { type?: string; networkId?: unknown; passphraseFingerprint?: string } | undefined;
        try {
          parsedWallet = JSON.parse(key);
        } catch (error) {
          console.warn('[ShroudApp] Failed to parse stored wallet payload:', error);
          continue;
        }

        if (parsedWallet?.type !== HDSilentPaymentsWallet.type) {
          presentAlert({
            message: `A wallet of type "${parsedWallet?.type ?? 'unknown'}" was found in storage but is no longer supported. Please restore it using its seed phrase before continuing. It will not be loaded.`,
          });
          continue;
        }

        const fingerprint = parsedWallet.passphraseFingerprint;
        if (fingerprint) {
          const networkId = normaliseStoredNetworkId(parsedWallet.networkId);
          // Matched on chain + fingerprint, not the blob: saving an unlocked wallet rewrites its blob,
          // and a reload must not lock it again next to the open copy.
          const isOpen = this.wallets.some(w => w.networkId === networkId && w.passphraseFingerprint === fingerprint);
          const isLocked = this.lockedWallets.some(l => l.networkId === networkId && l.fingerprint === fingerprint);
          if (!isOpen && !isLocked) {
            this.lockedWallets.push({ networkId, fingerprint, blob: key });
          }
          continue;
        }

        const deserializedWallet = HDSilentPaymentsWallet.fromJson(key) as unknown as HDSilentPaymentsWallet;

        try {
          if (realm) this.inflateWalletFromRealm(realm, deserializedWallet);
        } catch (error: any) {
          presentAlert({ message: error.message });
        }

        // done
        const ID = deserializedWallet.getID();
        if (!this.wallets.some(wallet => wallet.getID() === ID)) {
          this.wallets.push(deserializedWallet);
        }
      }
      if (realm) realm.close();

      for (const draft of data.pendingWallets ?? []) {
        const wallet = HDSilentPaymentsWallet.fromJson(draft);
        const chainTaken =
          this.wallets.some(w => w.networkId === wallet.networkId) ||
          this.lockedWallets.some(l => l.networkId === wallet.networkId) ||
          this.pendingWallets.some(w => w.networkId === wallet.networkId);
        if (!chainTaken) this.pendingWallets.push(wallet);
      }
      return true;
    } else {
      return false; // failed loading data or loading/decryption data
    }
  }

  /** The selected chain's created-but-not-backed-up wallet, if any. */
  getPendingWallet = (): TWallet | null => {
    const activeNetworkId = getActiveNetworkId();
    return this.pendingWallets.find(w => w.networkId === activeNetworkId) ?? null;
  };

  /** Replaces the draft for `wallet`'s chain. The caller saves. */
  setPendingWallet = (wallet: TWallet): void => {
    this.pendingWallets = [...this.pendingWallets.filter(w => w.networkId !== wallet.networkId), wallet];
  };

  /** Drops the selected chain's draft. The caller saves. */
  clearPendingWallet = (): void => {
    const activeNetworkId = getActiveNetworkId();
    this.pendingWallets = this.pendingWallets.filter(w => w.networkId !== activeNetworkId);
  };

  /** Whether the selected chain's wallet is waiting for its passphrase. */
  hasLockedWallet = (): boolean => {
    const activeNetworkId = getActiveNetworkId();
    return this.lockedWallets.some(locked => locked.networkId === activeNetworkId);
  };

  /**
   * Opens the selected chain's passphrase wallet and moves it into `this.wallets`. Returns null,
   * changing nothing, when the passphrase is wrong.
   */
  unlockWallet = async (passphrase: string): Promise<TWallet | null> => {
    const activeNetworkId = getActiveNetworkId();
    const locked = this.lockedWallets.find(l => l.networkId === activeNetworkId);
    if (!locked) return null;

    const wallet = HDSilentPaymentsWallet.unlockFromJson(locked.blob, passphrase);
    if (!wallet) return null;

    let realm;
    try {
      realm = await this.getRealmForTransactions();
      this.inflateWalletFromRealm(realm, wallet);
    } catch (error: any) {
      presentAlert({ message: error.message });
    } finally {
      realm?.close();
    }

    this.lockedWallets = this.lockedWallets.filter(l => l !== locked);
    this.wallets.push(wallet);
    return wallet;
  };

  /**
   * Drops the selected chain's passphrase wallet without opening it, with its cached transactions.
   * Its ID needs only the stored fingerprint, not the passphrase. The caller saves.
   */
  forgetLockedWallet = async (): Promise<void> => {
    const activeNetworkId = getActiveNetworkId();
    const forgotten = this.lockedWallets.filter(l => l.networkId === activeNetworkId);
    this.lockedWallets = this.lockedWallets.filter(l => l.networkId !== activeNetworkId);

    let realm;
    try {
      realm = await this.getRealmForTransactions();
      for (const locked of forgotten) {
        const id = HDSilentPaymentsWallet.fromJson(locked.blob).getID();
        realm.write(() => realm!.delete(realm!.objects('WalletTransactions').filtered(`walletid = '${id}'`)));
      }
    } catch (error: any) {
      console.warn('[ShroudApp] Could not clear cached transactions of a forgotten wallet:', error.message);
    } finally {
      realm?.close();
    }
  };

  /**
   * Lookup wallet in list by it's secret and
   * remove it from `this.wallets`
   *
   * @param wallet {AbstractWallet}
   */
  deleteWallet = (wallet: TWallet): void => {
    const ID = wallet.getID();
    const tempWallets = [];

    for (const value of this.wallets) {
      if (value.getID() === ID) {
        // the one we should delete
        // nop
      } else {
        // the one we must keep
        tempWallets.push(value);
      }
    }
    this.wallets = tempWallets;
  };

  inflateWalletFromRealm(realm: Realm, walletToInflate: TWallet) {
    const transactions = realm.objects('WalletTransactions');
    const transactionsForWallet = transactions.filtered(`walletid = "${walletToInflate.getID()}"`) as unknown as TRealmTransaction[];
    for (const tx of transactionsForWallet) {
      if (tx.internal === false) {
        walletToInflate._txs_by_external_index[tx.index] = walletToInflate._txs_by_external_index[tx.index] || [];
        const transaction = JSON.parse(tx.tx);
        walletToInflate._txs_by_external_index[tx.index].push(transaction);
      } else if (tx.internal === true) {
        walletToInflate._txs_by_internal_index[tx.index] = walletToInflate._txs_by_internal_index[tx.index] || [];
        const transaction = JSON.parse(tx.tx);
        walletToInflate._txs_by_internal_index[tx.index].push(transaction);
      } else {
        console.warn('inflateWalletFromRealm: unexpected tx.internal value, skipping record:', tx.internal);
      }
    }
  }

  offloadWalletToRealm(realm: Realm, wallet: TWallet): void {
    const id = wallet.getID();
    const walletToSave = wallet;

    if (Array.isArray(walletToSave._txs_by_external_index)) {
      // if this var is an array that means its a single-address wallet class, and this var is a flat array
      // with transactions
      realm.write(() => {
        // cleanup all existing transactions for the wallet first
        const walletTransactionsToDelete = realm.objects('WalletTransactions').filtered(`walletid = '${id}'`);
        realm.delete(walletTransactionsToDelete);

        // @ts-ignore walletToSave._txs_by_external_index is array
        for (const tx of walletToSave._txs_by_external_index) {
          realm.create(
            'WalletTransactions',
            {
              walletid: id,
              tx: JSON.stringify(tx),
            },
            Realm.UpdateMode.Modified,
          );
        }
      });

      return;
    }

    /// ########################################################################################################

    if (walletToSave._txs_by_external_index) {
      realm.write(() => {
        // cleanup all existing transactions for the wallet first
        const walletTransactionsToDelete = realm.objects('WalletTransactions').filtered(`walletid = '${id}'`);
        realm.delete(walletTransactionsToDelete);

        // insert new ones:
        for (const index of Object.keys(walletToSave._txs_by_external_index)) {
          // @ts-ignore index is number
          const txs = walletToSave._txs_by_external_index[index];
          for (const tx of txs) {
            realm.create(
              'WalletTransactions',
              {
                walletid: id,
                internal: false,
                index: parseInt(index, 10),
                tx: JSON.stringify(tx),
              },
              Realm.UpdateMode.Modified,
            );
          }
        }

        for (const index of Object.keys(walletToSave._txs_by_internal_index)) {
          // @ts-ignore index is number
          const txs = walletToSave._txs_by_internal_index[index];
          for (const tx of txs) {
            realm.create(
              'WalletTransactions',
              {
                walletid: id,
                internal: true,
                index: parseInt(index, 10),
                tx: JSON.stringify(tx),
              },
              Realm.UpdateMode.Modified,
            );
          }
        }
      });
    }
  }

  /**
   * Serializes and saves to storage object data.
   * If cached password is saved - finds the correct bucket
   * to save to, encrypts and then saves.
   *
   * @returns {Promise} Result of storage save
   */
  async saveToDisk(): Promise<void> {
    if (savingInProgress) {
      console.warn('saveToDisk is in progress');
      if (++savingInProgress > 10) presentAlert({ message: 'Critical error. Last actions were not saved' }); // should never happen
      await new Promise(resolve => setTimeout(resolve, 1000 * savingInProgress)); // sleep
      return this.saveToDisk();
    }
    savingInProgress = 1;

    try {
      const walletsToSave: string[] = []; // serialized wallets
      let realm;
      try {
        realm = await this.getRealmForTransactions();
      } catch (error: any) {
        presentAlert({ message: error.message });
      }
      // Every network's wallets, not just the active one's — this array is what replaces the
      // stored bucket, so narrowing it here would drop the other chains' wallets.
      for (const key of this.wallets) {
        if (typeof key === 'boolean') continue;
        key.prepareForSerialization();
        // @ts-ignore wtf is wallet.current? Does it even exist?
        delete key.current;
        const keyCloned: any = key instanceof HDSilentPaymentsWallet ? key.toPersistable() : Object.assign({}, key); // stripped-down version of a wallet to save to secure keystore
        if ('_hdWalletInstance' in key) {
          const k = keyCloned as any;
          k._hdWalletInstance = Object.assign({}, key._hdWalletInstance);
          k._hdWalletInstance._txs_by_external_index = {};
          k._hdWalletInstance._txs_by_internal_index = {};
        }
        if (realm) this.offloadWalletToRealm(realm, key);
        // stripping down:
        if (key._txs_by_external_index) {
          keyCloned._txs_by_external_index = {};
          keyCloned._txs_by_internal_index = {};
        }

        walletsToSave.push(JSON.stringify({ ...keyCloned, type: keyCloned.type }));
      }
      if (realm) realm.close();
      // Written back as read: dropping them here would delete every wallet still waiting for its passphrase.
      for (const locked of this.lockedWallets) walletsToSave.push(locked.blob);

      const pendingToSave = this.pendingWallets.map(draft => {
        draft.prepareForSerialization();
        return JSON.stringify({ ...draft.toPersistable(), type: draft.type });
      });

      let data: TBucketStorage | string[] /* either a bucket, or an array of encrypted buckets */ = {
        wallets: walletsToSave,
        pendingWallets: pendingToSave,
        tx_metadata: this.tx_metadata,
        contacts: this.contacts,
      };

      if (this.cachedPassword) {
        // should find the correct bucket, encrypt and then save
        let buckets = await this.getItemWithFallbackToRealm('data');
        buckets = JSON.parse(buckets);
        const newData: string[] = []; // serialized buckets
        let num = 0;
        for (const bucket of buckets) {
          let decrypted;
          // if we had `usedBucketNum` during loadFromDisk(), no point to try to decode each bucket to find the one we
          // need, we just to find bucket with the same index
          if (usedBucketNum !== false) {
            if (num === usedBucketNum) {
              decrypted = true;
            }
            num++;
          } else {
            // we dont have `usedBucketNum` for whatever reason, so lets try to decrypt each bucket after bucket
            // till we find the right one
            decrypted = encryption.decrypt(bucket, this.cachedPassword);
          }

          if (!decrypted) {
            // no luck decrypting, its not our bucket
            newData.push(bucket);
          } else {
            // decrypted ok, this is our bucket
            // we serialize our object's data, encrypt it, and add it to buckets
            newData.push(encryption.encrypt(JSON.stringify(data), this.cachedPassword));
          }
        }

        data = newData;
      }

      await this.setItem('data', JSON.stringify(data));
      await this.setItem(ShroudApp.FLAG_ENCRYPTED, this.cachedPassword ? '1' : '');

      // now, backing up same data in realm:
      const realmkeyValue = await this.openRealmKeyValue();
      this.saveToRealmKeyValue(realmkeyValue, 'data', JSON.stringify(data));
      this.saveToRealmKeyValue(realmkeyValue, ShroudApp.FLAG_ENCRYPTED, this.cachedPassword ? '1' : '');
      realmkeyValue.close();
    } catch (error: any) {
      console.error('save to disk exception:', error.message);
      presentAlert({ message: 'save to disk exception: ' + error.message });
      if (error.message.includes('Realm file decryption failed')) {
        console.warn('purging realm key-value database file');
        this.purgeRealmKeyValueFile();
      }
    } finally {
      savingInProgress = 0;
    }
  }

  /**
   * For each wallet, fetches balance from remote endpoint.
   * Use getter for a specific wallet to get actual balance.
   * Returns void.
   * If index is present then fetch only from this specific wallet
   */
  fetchWalletBalances = async (index?: number): Promise<void> => {
    console.log('fetchWalletBalances for wallet#', typeof index === 'undefined' ? '(all)' : index);
    if (index || index === 0) {
      let c = 0;
      for (const wallet of this.activeWallets) {
        if (c++ === index) {
          await wallet.fetchBalance();
        }
      }
    } else {
      for (const wallet of this.activeWallets) {
        console.log('fetching balance for', wallet.getLabel());
        await wallet.fetchBalance();
      }
    }
  };

  /**
   * Fetches from remote endpoint all transactions for each wallet.
   * Returns void.
   * To access transactions - get them from each respective wallet.
   * If index is present then fetch only from this specific wallet.
   *
   * @param index {Integer} Index of the wallet in this.wallets array,
   *                        blank to fetch from all wallets
   * @return {Promise.<void>}
   */
  fetchWalletTransactions = async (index?: number) => {
    console.log('fetchWalletTransactions for wallet#', typeof index === 'undefined' ? '(all)' : index);
    if (index || index === 0) {
      let c = 0;
      for (const wallet of this.activeWallets) {
        if (c++ === index) {
          await wallet.fetchTransactions();

          if ('fetchPendingTransactions' in wallet) {
            await (wallet as any).fetchPendingTransactions();
          }
        }
      }
    } else {
      for (const wallet of this.activeWallets) {
        await wallet.fetchTransactions();
        if ('fetchPendingTransactions' in wallet) {
          await (wallet as any).fetchPendingTransactions();
        }
      }
    }
  };

  /**
   * Wallets on the currently selected chain.
   *
   * `this.wallets` deliberately holds every network's wallets at once, because `saveToDisk`
   * serializes that array wholesale — filtering it in place would delete the other chains'
   * wallets on the next save. So the rule throughout this class is: **filter on read, never on
   * write.**
   */
  private get activeWallets(): TWallet[] {
    const activeNetworkId = getActiveNetworkId();
    return this.wallets.filter(w => w.networkId === activeNetworkId);
  }

  getWallets = (): TWallet[] => {
    return this.activeWallets;
  };

  /** Every wallet across every chain. Only for persistence; the UI wants `getWallets()`. */
  getAllWalletsAcrossNetworks = (): TWallet[] => {
    return this.wallets;
  };

  /**
   * Getter for all transactions in all wallets.
   * But if index is provided - only for wallet with corresponding index
   *
   * @param index {number|undefined} Wallet index in this.wallets. Empty (or undef) for all wallets.
   * @param limit {number} How many txs return, starting from the earliest. Default: all of them.
   * @param includeWalletsWithHideTransactionsEnabled {boolean} Wallets' _hideTransactionsInWalletsList property determines wether the user wants this wallet's txs hidden from the main list view.
   */
  getTransactions = (
    index?: number,
    limit: number = Infinity,
    includeWalletsWithHideTransactionsEnabled: boolean = false,
  ): ExtendedTransaction[] => {
    if (index || index === 0) {
      let txs: Transaction[] = [];
      let c = 0;
      for (const wallet of this.activeWallets) {
        if (c++ === index) {
          txs = txs.concat(wallet.getTransactions());

          const txsRet: ExtendedTransaction[] = [];
          const walletID = wallet.getID();
          const walletPreferredBalanceUnit = wallet.getPreferredBalanceUnit();
          txs.map(tx =>
            txsRet.push({
              ...tx,
              walletID,
              walletPreferredBalanceUnit,
            }),
          );
          return txsRet;
        }
      }
    }

    const txs: ExtendedTransaction[] = [];
    for (const wallet of this.activeWallets.filter(
      w => includeWalletsWithHideTransactionsEnabled || !w.getHideTransactionsInWalletsList(),
    )) {
      const walletTransactions: Transaction[] = wallet.getTransactions();
      const walletID = wallet.getID();
      const walletPreferredBalanceUnit = wallet.getPreferredBalanceUnit();
      for (const t of walletTransactions) {
        txs.push({
          ...t,
          walletID,
          walletPreferredBalanceUnit,
        });
      }
    }

    return txs
      .sort((a, b) => {
        return b.timestamp - a.timestamp;
      })
      .slice(0, limit);
  };

  /**
   * Getter for a sum of all balances of all wallets
   */
  getBalance = (): number => {
    let finalBalance = 0;
    for (const wal of this.activeWallets) {
      finalBalance += wal.getBalance();
    }
    return finalBalance;
  };

  isDoNotTrackEnabled = async (): Promise<boolean> => {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    try {
      const keyExists = await AsyncStorage.getItem(ShroudApp.DO_NOT_TRACK);
      if (keyExists !== null) {
        const doNotTrackValue = !!keyExists;
        if (doNotTrackValue) {
          await DefaultPreference.set(ShroudApp.DO_NOT_TRACK, '1');
          await AsyncStorage.removeItem(ShroudApp.DO_NOT_TRACK);
        } else {
          return Boolean(await DefaultPreference.get(ShroudApp.DO_NOT_TRACK));
        }
      }
    } catch (_) {}
    const doNotTrackValue = await DefaultPreference.get(ShroudApp.DO_NOT_TRACK);
    return doNotTrackValue === '1' || false;
  };

  /**
   * Simple async sleeper function
   */
  sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  purgeRealmKeyValueFile() {
    const path = 'keyvalue.realm';
    return Realm.deleteFile({
      path,
    });
  }

  async moveRealmFilesToCacheDirectory() {
    const documentPath = RNFS.DocumentDirectoryPath; // Path to documentPath folder
    const cachePath = RNFS.CachesDirectoryPath; // Path to cachePath folder
    try {
      if (!(await RNFS.exists(documentPath))) return; // If the documentPath directory does not exist, return (nothing to move)
      const files = await RNFS.readDir(documentPath); // Read all files in documentPath directory
      if (Array.isArray(files) && files.length === 0) return; // If there are no files, return (nothing to move)
      const appRealmFiles = files.filter(
        file => file.name.endsWith('.realm') || file.name.endsWith('.realm.lock') || file.name.includes('.realm.management'),
      );

      for (const file of appRealmFiles) {
        const filePath = `${documentPath}/${file.name}`;
        const newFilePath = `${cachePath}/${file.name}`;
        const fileExists = await RNFS.exists(filePath); // Check if the file exists
        const cacheFileExists = await RNFS.exists(newFilePath); // Check if the file already exists in the cache directory

        if (fileExists) {
          if (cacheFileExists) {
            await RNFS.unlink(newFilePath); // Delete the file in the cache directory if it exists
            console.log(`Existing file removed from cache: ${newFilePath}`);
          }
          await RNFS.moveFile(filePath, newFilePath); // Move the file
          console.log(`Moved Realm file: ${filePath} to ${newFilePath}`);
        } else {
          console.log(`File does not exist: ${filePath}`);
        }
      }
    } catch (error) {
      console.error('Error moving Realm files:', error);
      throw new Error(`Error moving Realm files: ${(error as Error).message}`);
    }
  }
}
