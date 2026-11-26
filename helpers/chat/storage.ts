import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';
import { GroupRumorHistory, type GenericKeyValueStore, type GroupHistoryFactory } from '@internet-privacy/marmot-ts';
import { KeyValueRumorHistoryBackend } from '@internet-privacy/marmot-ts/extra';
import type { Rumor } from 'applesauce-common/helpers/gift-wrap';

/** The slice of AsyncStorage the chat stores need. Injected so tests can use a Map. */
export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ------------------------------------------------------------------ tagged JSON */

/**
 * JSON that survives `Uint8Array` and `bigint`: plain `JSON.stringify` turns a Uint8Array into an
 * index map and throws on bigint. `Buffer` (the app polyfills buffer@6) has its own `toJSON`, which
 * runs before a replacer sees the value, so the original is read from `this[key]` instead.
 */
export function encodeValue(value: unknown): string {
  return JSON.stringify(value, function (this: any, key: string, v: unknown) {
    const raw = this[key];
    if (raw instanceof Uint8Array) return { $u8: base64.encode(raw) };
    if (typeof v === 'bigint') return { $big: v.toString() };
    return v;
  });
}

export function decodeValue<T>(text: string): T {
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1) {
        if (keys[0] === '$u8' && typeof v.$u8 === 'string') return base64.decode(v.$u8);
        if (keys[0] === '$big' && typeof v.$big === 'string') return BigInt(v.$big);
      }
    }
    return v;
  }) as T;
}

/* ------------------------------------------------------------------ encryption at rest */

const STORE_SALT = enc.encode('shroud-chat-store');
const STORE_INFO = enc.encode('v1');
const FORMAT_PREFIX = 'v1.';
const NONCE_LENGTH = 12;

/** AES-256 key for a wallet's chat stores, bound to its chat secret so real and decoy buckets stay apart. */
export function deriveStoreKey(chatSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, chatSecret, STORE_SALT, STORE_INFO, 32);
}

/**
 * `v1.` + base64(nonce ‖ ciphertext‖tag). A fresh random nonce per write. The storage key is bound
 * in as AAD, so a ciphertext copied to another key fails to open instead of decrypting wrongly.
 */
export function seal(key: Uint8Array, storageKey: string, plaintext: string): string {
  const nonce = randomBytes(NONCE_LENGTH);
  const ct = gcm(key, nonce, enc.encode(storageKey)).encrypt(enc.encode(plaintext));
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return FORMAT_PREFIX + base64.encode(out);
}

export function open(key: Uint8Array, storageKey: string, sealed: string): string {
  if (!sealed.startsWith(FORMAT_PREFIX)) throw new Error('chat storage: unknown format');
  const bytes = base64.decode(sealed.slice(FORMAT_PREFIX.length));
  if (bytes.length < NONCE_LENGTH + 16) throw new Error('chat storage: value too short');
  const pt = gcm(key, bytes.slice(0, NONCE_LENGTH), enc.encode(storageKey)).decrypt(bytes.slice(NONCE_LENGTH));
  return dec.decode(pt);
}

/* ------------------------------------------------------------------ the store */

const NAMESPACE = 'shroud-chat';

/** `shroud-chat:<pubkey>:<store>:` — everything a wallet's chat keeps lives under its own pubkey. */
export const storePrefix = (pubkey: string, store: string): string => `${NAMESPACE}:${pubkey}:${store}:`;

/**
 * A marmot-ts `GenericKeyValueStore<T>` over AsyncStorage: tagged JSON, AES-256-GCM per value, keys
 * namespaced by wallet pubkey and store name. A value that fails to decrypt reads as absent rather
 * than throwing, so one corrupt record cannot wedge the client at startup.
 */
export class ChatKeyValueStore<T> implements GenericKeyValueStore<T> {
  private readonly prefix: string;

  constructor(
    private readonly backend: StorageBackend,
    pubkey: string,
    store: string,
    private readonly key: Uint8Array,
    private readonly onCorrupt?: (storageKey: string, error: unknown) => void,
  ) {
    this.prefix = storePrefix(pubkey, store);
  }

  async getItem(key: string): Promise<T | null> {
    const storageKey = this.prefix + key;
    const sealed = await this.backend.getItem(storageKey);
    if (sealed === null) return null;
    try {
      return decodeValue<T>(open(this.key, storageKey, sealed));
    } catch (e) {
      this.onCorrupt?.(storageKey, e);
      return null;
    }
  }

  async setItem(key: string, value: T): Promise<T> {
    const storageKey = this.prefix + key;
    await this.backend.setItem(storageKey, seal(this.key, storageKey, encodeValue(value)));
    return value;
  }

  async removeItem(key: string): Promise<void> {
    await this.backend.removeItem(this.prefix + key);
  }

  async keys(): Promise<string[]> {
    return (await this.backend.getAllKeys()).filter(k => k.startsWith(this.prefix)).map(k => k.slice(this.prefix.length));
  }

  async clear(): Promise<void> {
    for (const k of await this.keys()) await this.removeItem(k);
  }
}

/* ------------------------------------------------------------------ the bundle a client needs */

/** Peer → group bookkeeping Shroud keeps beside marmot-ts's own state. See ChatService. */
export type ChatIndexStore = GenericKeyValueStore<any>;

export interface ChatStores {
  groupStateStore: GenericKeyValueStore<any>;
  keyPackageStore: GenericKeyValueStore<any>;
  inviteStore: GenericKeyValueStore<any>;
  ingestStateStore: GenericKeyValueStore<Uint8Array>;
  rewindStore: GenericKeyValueStore<Uint8Array>;
  removedMarkerStore: GenericKeyValueStore<boolean>;
  lifecycleStore: GenericKeyValueStore<Uint8Array>;
  historyFactory: GroupHistoryFactory<GroupRumorHistory>;
  indexStore: ChatIndexStore;
  /** 32 random bytes as hex, persisted per pubkey so key packages keep a stable addressable slot. */
  clientId: string;
}

export async function createChatStores(
  backend: StorageBackend,
  pubkey: string,
  chatSecret: Uint8Array,
  onCorrupt?: (storageKey: string, error: unknown) => void,
): Promise<ChatStores> {
  const key = deriveStoreKey(chatSecret);
  const make = <T>(store: string) => new ChatKeyValueStore<T>(backend, pubkey, store, key, onCorrupt);

  const meta = make<string>('meta');
  let clientId = await meta.getItem('clientId');
  if (!clientId || !/^[0-9a-f]{64}$/.test(clientId)) {
    clientId = bytesToHex(randomBytes(32));
    await meta.setItem('clientId', clientId);
  }

  return {
    groupStateStore: make('group-state'),
    keyPackageStore: make('key-package'),
    inviteStore: make('invite'),
    ingestStateStore: make('ingest-state'),
    rewindStore: make('rewind'),
    removedMarkerStore: make('removed-marker'),
    lifecycleStore: make('lifecycle'),
    // One history store per group, so a group's messages can be listed and cleared on their own.
    historyFactory: (groupId: Uint8Array) =>
      new GroupRumorHistory(new KeyValueRumorHistoryBackend(make<Rumor>(`history:${bytesToHex(groupId)}`))),
    indexStore: make('index'),
    clientId,
  };
}

/** Removes every chat record a wallet owns (used when chat is turned off and its data discarded). */
export async function wipeChatStorage(backend: StorageBackend, pubkey: string): Promise<void> {
  const prefix = `${NAMESPACE}:${pubkey}:`;
  for (const k of await backend.getAllKeys()) if (k.startsWith(prefix)) await backend.removeItem(k);
}

/** Removes every chat record of every wallet on the device: what a device wipe uses. */
export async function wipeAllChatStorage(backend: StorageBackend): Promise<void> {
  for (const k of await backend.getAllKeys()) if (k.startsWith(`${NAMESPACE}:`)) await backend.removeItem(k);
}
