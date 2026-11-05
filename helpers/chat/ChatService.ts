import {
  MarmotClient,
  GroupRumorHistory,
  createApplicationMessageIntent,
  createInboxRelayListEvent,
  createNip65RelayListEvent,
  getNip65Relays,
  type MarmotGroup,
} from '@internet-privacy/marmot-ts';
import type { NostrNetworkInterface, Unsubscribable } from '@internet-privacy/marmot-ts/client';
import { nobleCryptoProvider } from '@internet-privacy/marmot-ts/mls';
import { bytesToHex } from '@noble/hashes/utils';
import type { Rumor } from 'applesauce-common/helpers/gift-wrap';
import type { NostrEvent } from 'applesauce-core/helpers/event';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import type { Network } from 'bitcoinjs-lib';
import {
  buildChatRumor,
  buildNoticeRumor,
  buildReceiptRumor,
  buildRequestRumor,
  parseRumor,
  MAX_TEXT_LENGTH,
  type ParsedChatEvent,
  type PaymentNotice,
  type PaymentReceipt,
  type PaymentRequest,
  type ReceiptStatus,
} from './events';
import { pubkeyFromAddress, type ChatIdentity } from './identity';
import { KIND_CHAT, KIND_KEY_PACKAGE, KIND_PAYMENT_NOTICE, KIND_PAYMENT_RECEIPT, KIND_PAYMENT_REQUEST, KIND_RELAY_LIST } from './kinds';
import { getChatRelays } from './relays';
import { createChatStores, type ChatStores, type StorageBackend } from './storage';

/* ------------------------------------------------------------------ public types */

export type ChatStatus = 'idle' | 'starting' | 'ready' | 'stopped' | 'error';

/** Everything the chat list needs about one conversation. Persisted. */
export interface PeerIndexEntry {
  /** The peer's chat pubkey (x-only hex). */
  peer: string;
  /** The current 1:1 group. */
  groupId: string;
  /** Who created the current group (the inviter). Decides duplicate-group races. */
  createdBy: string;
  /** Unix seconds the current group was created or joined. */
  createdAt: number;
  /** Earlier groups with this peer (replaced after a peer re-invited), newest first. Still read for history. */
  previous: string[];
  unread: number;
  lastMessage?: LastMessage;
}

export interface LastMessage {
  kind: 'text' | 'notice' | 'request';
  /** Text for `kind: 'text'`. */
  text?: string;
  /** Sats for notices and requests. */
  amount?: number;
  at: number;
  mine: boolean;
}

/** An invite from someone who is not a saved contact. Shown for accept or decline. */
export interface MessageRequest {
  /** The Welcome rumor id. */
  id: string;
  from: string;
  at: number;
}

export type IncomingNoticeStatus = 'verifying' | 'pending' | 'confirmed' | 'waiting';
export type OutgoingNoticeStatus = 'sent' | 'received' | 'confirmed';

/** Local state for a payment notice card (the payment-side verdict is not in the message history). */
export interface CardState {
  noticeId: string;
  status: IncomingNoticeStatus | OutgoingNoticeStatus;
  /** Sats the receiver's own scan matched. Never taken from the message. */
  amount?: number;
  updatedAt: number;
}

export type RequestStatus = 'open' | 'paid' | 'declined' | 'expired';

export type ThreadItem =
  | { kind: 'text'; id: string; mine: boolean; at: number; text: string }
  | {
      kind: 'notice';
      id: string;
      mine: boolean;
      at: number;
      notice: PaymentNotice;
      status: IncomingNoticeStatus | OutgoingNoticeStatus;
      /** Incoming: the matched amount once known; outgoing: what we sent. */
      amount?: number;
      requestId?: string;
    }
  | { kind: 'request'; id: string; mine: boolean; at: number; request: PaymentRequest; status: RequestStatus };

export type ChatEvents = {
  status: (status: ChatStatus) => void;
  /** The conversation list or message requests changed. */
  index: () => void;
  /** A conversation's messages or card states changed (peer pubkey). */
  thread: (peer: string) => void;
  /** A well-formed payment notice arrived from a peer, on this wallet's network. */
  notice: (event: { peer: string; noticeId: string; notice: PaymentNotice; rumor: Rumor }) => void;
  /** A payment notice we sent went out, so its confirmation can be followed. */
  noticeSent: (event: { peer: string; noticeId: string; txid: string }) => void;
};

/** A payment notice whose card has not reached Confirmed, with what is needed to keep working on it. */
export interface PendingNotice {
  peer: string;
  noticeId: string;
  mine: boolean;
  notice: PaymentNotice;
  status: IncomingNoticeStatus | OutgoingNoticeStatus;
  amount?: number;
}

export class PeerNotOnChatError extends Error {
  constructor(public readonly peer: string) {
    super('That contact has not published a chat key package yet');
    this.name = 'PeerNotOnChatError';
  }
}

export class ChatNotReadyError extends Error {
  constructor() {
    super('Chat is not running');
    this.name = 'ChatNotReadyError';
  }
}

export interface ChatServiceOptions {
  identity: ChatIdentity;
  network: NostrNetworkInterface;
  backend: StorageBackend;
  /** The wallet's network id (`signet`, …). Notices and requests for another network are ignored. */
  networkId: string;
  /** Address encoding for `pubkeyFromAddress`. */
  bitcoinNetwork: Network;
  /** The saved contacts' normalized silent payment addresses. */
  getContactAddresses: () => string[];
  /** The shared relay list. Defaults to the app-wide one. */
  getRelays?: () => string[];
  /** Unix seconds. */
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
}

/* ------------------------------------------------------------------ small helpers */

class Emitter<E extends Record<string, (...args: any[]) => void>> {
  private listeners = new Map<keyof E, Set<(...args: any[]) => void>>();

  on<K extends keyof E>(event: K, fn: E[K]): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  protected emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try {
        fn(...args);
      } catch (e) {
        // A listener must not break the service.
        console.warn('[chat] listener threw', e);
      }
    }
  }
}

/** Runs tasks one at a time, in order, surviving failures. */
class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

const RACE_WINDOW_SECONDS = 120;
const KEY_PACKAGE_CACHE_MS = 60_000;
const MAX_INVITE_ATTEMPTS = 3;
const PREVIEW_LENGTH = 200;

const indexKey = (peer: string) => `peer:${peer}`;
const requestKey = (id: string) => `req:${id}`;
const cardKey = (noticeId: string) => `card:${noticeId}`;
const META_RELAY_LISTS = 'meta:relayLists';
const REQUEST_RESPONSE_KEY = (requestId: string) => `reqstate:${requestId}`;

type Group = MarmotGroup<GroupRumorHistory, any>;

/* ------------------------------------------------------------------ the service */

/**
 * One wallet's chat: a MarmotClient plus Shroud's own bookkeeping. 1:1 chats are two-member Marmot
 * groups; whoever messages first creates the group and invites the peer's newest key package. Invites
 * from saved contacts are joined automatically, anything else waits as a message request.
 *
 * The service knows nothing about wallets. Payment detection plugs in by listening for `notice` and
 * answering through `setCardState` and `sendReceipt`.
 */
export class ChatService extends Emitter<ChatEvents> {
  private readonly opts: ChatServiceOptions;
  private readonly me: string;
  private readonly now: () => number;
  private readonly relays: () => string[];
  private readonly queue = new Queue();
  private readonly groupQueues = new Map<string, Queue>();

  private client?: MarmotClient<GroupRumorHistory, undefined>;
  private stores?: ChatStores;
  private statusValue: ChatStatus = 'idle';
  private groupsSub?: Unsubscribable;
  private invitesSub?: Unsubscribable;
  private offDecrypted?: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private settledPromise: Promise<void> = Promise.resolve();

  private readonly peers = new Map<string, PeerIndexEntry>();
  private readonly requests = new Map<string, MessageRequest>();
  private readonly cards = new Map<string, CardState>();
  private readonly attached = new Set<string>();
  private readonly noticePeers = new Map<string, string>();
  private readonly addressByPubkey = new Map<string, string>();
  private readonly pubkeyByAddress = new Map<string, string>();
  private readonly keyPackageCache = new Map<string, { at: number; present: boolean }>();

  constructor(options: ChatServiceOptions) {
    super();
    this.opts = options;
    this.me = options.identity.pubkey;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.relays = options.getRelays ?? getChatRelays;
  }

  /* -------------------------------------------------------------- lifecycle */

  get status(): ChatStatus {
    return this.statusValue;
  }

  get pubkey(): string {
    return this.me;
  }

  /** Resolves once the background network work started by `start()` has finished (or given up for now). */
  settled(): Promise<void> {
    return this.settledPromise;
  }

  private setStatus(status: ChatStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.emit('status', status);
  }

  private log(message: string, error?: unknown): void {
    this.opts.log?.(message, error);
  }

  /**
   * Opens local state, then starts the network work (publishing, group subscriptions, invite listener)
   * without waiting on it: a dead relay must not hold the app. `settled()` waits for it.
   */
  async start(): Promise<void> {
    if (this.statusValue === 'starting' || this.statusValue === 'ready') return;
    this.setStatus('starting');
    try {
      const { identity, network } = this.opts;
      this.stores = await createChatStores(this.opts.backend, identity.pubkey, identity.secretKey, (key, e) =>
        this.log(`corrupt chat record ${key}`, e),
      );
      const stores = this.stores;
      this.client = new MarmotClient<GroupRumorHistory, undefined>({
        signer: new PrivateKeySigner(identity.secretKey),
        network,
        cryptoProvider: nobleCryptoProvider,
        groupStateStore: stores.groupStateStore,
        keyPackageStore: stores.keyPackageStore,
        inviteStore: stores.inviteStore,
        ingestStateStore: stores.ingestStateStore,
        rewindStore: stores.rewindStore,
        removedMarkerStore: stores.removedMarkerStore,
        lifecycleStore: stores.lifecycleStore,
        clientId: stores.clientId,
        historyFactory: stores.historyFactory,
      });
      if (this.client.ingestPersistence.kind !== 'durable') throw new Error('chat: ingest state is not durable');

      await this.loadIndex();

      const client = this.client;
      // Attach before connecting so backfilled messages are seen; groups created or joined later attach as they appear.
      for (const group of await client.groups.loadAll()) this.attachGroup(group as Group);
      for (const event of ['loaded', 'created', 'joined'] as const) client.groups.on(event, g => this.attachGroup(g as Group));
      client.groups.on('removed', groupId => this.onGroupRemoved(bytesToHex(groupId)));

      this.setStatus('ready');
      this.settledPromise = this.startNetwork();
    } catch (e) {
      this.log('chat failed to start', e);
      this.setStatus('error');
      throw e;
    }
  }

  /** Call when the app returns to the foreground: sockets may have died, so re-subscribe and backfill. */
  resume(): Promise<void> {
    if (this.statusValue !== 'ready') return Promise.resolve();
    this.settledPromise = this.startNetwork();
    return this.settledPromise;
  }

  private async startNetwork(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      this.groupsSub?.unsubscribe();
      this.invitesSub?.unsubscribe();
      this.offDecrypted?.();
      this.groupsSub = client.groups.connectAll();
      const inbox = await this.opts.network.getUserInboxRelays(this.me);
      client.invites.on('decrypted', this.onDecrypted);
      this.offDecrypted = () => client.invites.off('decrypted', this.onDecrypted);
      this.invitesSub = await client.invites.listen(inbox);
      for (const invite of await client.invites.getUnread()) await this.handleInvite(invite);
      await this.ensurePublished();
    } catch (e) {
      this.log('chat network startup failed, will retry', e);
      this.scheduleRetry(10_000);
    }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer || this.statusValue !== 'ready') return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.statusValue !== 'ready') return;
      this.settledPromise = this.ensurePublished().catch(e => {
        this.log('chat publish retry failed', e);
        this.scheduleRetry(Math.min(delayMs * 2, 5 * 60_000));
      });
    }, delayMs);
  }

  async stop(): Promise<void> {
    if (this.statusValue === 'stopped' || this.statusValue === 'idle') return;
    this.setStatus('stopped');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.groupsSub?.unsubscribe();
    this.invitesSub?.unsubscribe();
    this.offDecrypted?.();
    this.groupsSub = this.invitesSub = this.offDecrypted = undefined;
    const client = this.client;
    if (client) {
      for (const group of client.groups.loaded) {
        try {
          group.dispose();
        } catch {
          // already disposed
        }
      }
    }
    this.attached.clear();
    this.client = undefined;
  }

  private requireClient(): MarmotClient<GroupRumorHistory, undefined> {
    if (!this.client || this.statusValue !== 'ready') throw new ChatNotReadyError();
    return this.client;
  }

  /* -------------------------------------------------------------- publishing */

  /** Publishes a key package (kind 30443) and, when the relay list changed, the 10002 and 10050 lists. */
  async ensurePublished(): Promise<void> {
    const client = this.requireClient();
    const relays = this.relays();
    await client.keyPackages.ensurePublished({ relays });
    await this.publishRelayLists(relays);
  }

  private async publishRelayLists(relays: string[]): Promise<void> {
    const stores = this.stores!;
    const hash = [...relays].sort().join(',');
    const done = (await stores.indexStore.getItem(META_RELAY_LISTS)) as string | null;
    if (done === hash) return;
    const signer = this.client!.signer;
    const publish = async (template: ReturnType<typeof createNip65RelayListEvent>) => {
      const signed = await signer.signEvent({
        kind: template.kind,
        content: template.content,
        tags: template.tags,
        created_at: this.now(),
      });
      const results = await this.opts.network.publish(relays, signed as NostrEvent);
      if (!Object.values(results).some(r => r.ok)) throw new Error('no relay accepted the relay list');
    };
    await publish(createNip65RelayListEvent({ pubkey: this.me, relays }));
    await publish(createInboxRelayListEvent({ pubkey: this.me, relays }));
    await stores.indexStore.setItem(META_RELAY_LISTS, hash);
  }

  /* -------------------------------------------------------------- contacts */

  /** The chat pubkey for a contact's silent payment address, or undefined when it does not parse on this network. */
  pubkeyForAddress(address: string): string | undefined {
    const key = address.trim().toLowerCase();
    const cached = this.pubkeyByAddress.get(key);
    if (cached) return cached;
    try {
      const pubkey = pubkeyFromAddress(key, this.opts.bitcoinNetwork);
      this.pubkeyByAddress.set(key, pubkey);
      this.addressByPubkey.set(pubkey, key);
      return pubkey;
    } catch {
      return undefined;
    }
  }

  /** The saved contact address behind a chat pubkey, if any. */
  addressForPubkey(pubkey: string): string | undefined {
    for (const address of this.opts.getContactAddresses()) this.pubkeyForAddress(address);
    const address = this.addressByPubkey.get(pubkey);
    return address && this.opts.getContactAddresses().includes(address) ? address : undefined;
  }

  /** Call after the contact list changes: a request from someone now saved is accepted. */
  async refreshContacts(): Promise<void> {
    for (const request of [...this.requests.values()]) {
      if (this.addressForPubkey(request.from)) await this.acceptRequest(request.id).catch(e => this.log('auto-accept failed', e));
    }
    this.emit('index');
  }

  /** Whether the contact has published a key package, i.e. can be messaged. Cached briefly. */
  async isOnChat(target: string, force = false): Promise<boolean> {
    const peer = this.resolvePeer(target);
    if (!peer) return false;
    if (this.peers.has(peer)) return true;
    const cached = this.keyPackageCache.get(peer);
    if (!force && cached && Date.now() - cached.at < KEY_PACKAGE_CACHE_MS) return cached.present;
    const packages = await this.fetchKeyPackages(peer);
    this.keyPackageCache.set(peer, { at: Date.now(), present: packages.length > 0 });
    return packages.length > 0;
  }

  /**
   * Which of these contacts have published a key package, from one batched relay query. Catches
   * peers on the shared relay list; `isOnChat` does the precise per-peer check (their own relays).
   * Returns chat pubkeys. Cached with `isOnChat`'s cache.
   */
  async discover(addresses: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    const unknown: string[] = [];
    for (const address of addresses) {
      const peer = this.pubkeyForAddress(address);
      if (!peer) continue;
      const cached = this.keyPackageCache.get(peer);
      if (this.peers.has(peer) || (cached && Date.now() - cached.at < KEY_PACKAGE_CACHE_MS && cached.present)) found.add(peer);
      else if (!cached || Date.now() - cached.at >= KEY_PACKAGE_CACHE_MS) unknown.push(peer);
    }
    for (let i = 0; i < unknown.length; i += 40) {
      const batch = unknown.slice(i, i + 40);
      const events = await this.opts.network.request(this.relays(), { kinds: [KIND_KEY_PACKAGE], authors: batch });
      const present = new Set(events.map(e => e.pubkey));
      for (const peer of batch) {
        this.keyPackageCache.set(peer, { at: Date.now(), present: present.has(peer) });
        if (present.has(peer)) found.add(peer);
      }
    }
    return found;
  }

  private async peerRelays(peer: string): Promise<string[]> {
    const relays = new Set(this.relays());
    try {
      const [list] = await this.opts.network.request(this.relays(), { kinds: [KIND_RELAY_LIST], authors: [peer], limit: 1 });
      if (list) for (const r of getNip65Relays(list, 'write')) relays.add(r);
    } catch (e) {
      this.log('could not read peer relay list', e);
    }
    return [...relays];
  }

  /** The peer's published key packages, newest first. */
  private async fetchKeyPackages(peer: string): Promise<NostrEvent[]> {
    const events = await this.opts.network.request(await this.peerRelays(peer), { kinds: [KIND_KEY_PACKAGE], authors: [peer] });
    return events.filter(e => e.pubkey === peer && e.kind === KIND_KEY_PACKAGE).sort((a, b) => b.created_at - a.created_at);
  }

  /* -------------------------------------------------------------- index */

  private async loadIndex(): Promise<void> {
    const store = this.stores!.indexStore;
    for (const key of await store.keys()) {
      const value = await store.getItem(key);
      if (!value) continue;
      if (key.startsWith('peer:')) this.peers.set((value as PeerIndexEntry).peer, value as PeerIndexEntry);
      else if (key.startsWith('req:')) this.requests.set((value as MessageRequest).id, value as MessageRequest);
      else if (key.startsWith('card:')) this.cards.set((value as CardState).noticeId, value as CardState);
    }
  }

  private async savePeer(entry: PeerIndexEntry): Promise<void> {
    this.peers.set(entry.peer, entry);
    await this.stores!.indexStore.setItem(indexKey(entry.peer), entry);
  }

  /** Conversations, most recent first. */
  listPeers(): PeerIndexEntry[] {
    return [...this.peers.values()].sort((a, b) => (b.lastMessage?.at ?? b.createdAt) - (a.lastMessage?.at ?? a.createdAt));
  }

  getPeer(peer: string): PeerIndexEntry | undefined {
    return this.peers.get(peer);
  }

  getRequests(): MessageRequest[] {
    return [...this.requests.values()].sort((a, b) => b.at - a.at);
  }

  totalUnread(): number {
    let total = 0;
    for (const p of this.peers.values()) total += p.unread;
    return total;
  }

  async markRead(peer: string): Promise<void> {
    const entry = this.peers.get(peer);
    if (!entry || entry.unread === 0) return;
    await this.savePeer({ ...entry, unread: 0 });
    this.emit('index');
  }

  /* -------------------------------------------------------------- card state */

  getCardState(noticeId: string): CardState | undefined {
    return this.cards.get(noticeId);
  }

  /** Records the payment-side status of a notice card and refreshes the thread. */
  async setCardState(noticeId: string, status: CardState['status'], amount?: number): Promise<void> {
    const prev = this.cards.get(noticeId);
    const next: CardState = { noticeId, status, amount: amount ?? prev?.amount, updatedAt: this.now() };
    this.cards.set(noticeId, next);
    await this.stores?.indexStore.setItem(cardKey(noticeId), next);
    // After a restart the notice-to-peer map is empty, so refresh every conversation rather than miss one.
    const peer = this.noticePeers.get(noticeId);
    for (const p of peer ? [peer] : this.peers.keys()) this.emit('thread', p);
  }

  /** Records that a request was declined locally (kept beside marmot's state; no message is sent). */
  async declineRequestCard(requestId: string): Promise<void> {
    await this.stores?.indexStore.setItem(REQUEST_RESPONSE_KEY(requestId), 'declined');
    for (const peer of this.peers.keys()) this.emit('thread', peer);
  }

  /* -------------------------------------------------------------- groups */

  private groupQueue(peer: string): Queue {
    let q = this.groupQueues.get(peer);
    if (!q) this.groupQueues.set(peer, (q = new Queue()));
    return q;
  }

  private peerOf(group: Group): string | undefined {
    return group.snapshot.members.find(m => m !== this.me);
  }

  private attachGroup(group: Group): void {
    const id = bytesToHex(group.id);
    if (this.attached.has(id)) return;
    this.attached.add(id);
    group.history.on('rumor', rumor => {
      this.onRumor(group, rumor).catch(e => this.log('failed to handle message', e));
    });
    group.history.on('removed', () => {
      const peer = this.peerOf(group);
      if (peer) this.emit('thread', peer);
    });
    group.on('historyError', e => this.log('history error', e));
  }

  private onGroupRemoved(groupId: string): void {
    for (const entry of this.peers.values()) {
      if (entry.groupId === groupId) this.emit('thread', entry.peer);
    }
  }

  /** The group for a peer, created and invited if there is none. Safe to call concurrently. */
  private ensureGroup(peer: string): Promise<Group> {
    return this.groupQueue(peer).run(async () => {
      const client = this.requireClient();
      const existing = this.peers.get(peer);
      if (existing) {
        try {
          const group = (await client.groups.get(existing.groupId)) as Group;
          if (group.status === 'active') return group;
        } catch (e) {
          this.log('existing group unusable, starting a new one', e);
        }
      }

      // A pending invite from this peer is theirs to finish before we create a competing group.
      const pending = (await client.invites.getUnread()).find(r => r.pubkey === peer);
      if (pending) {
        await this.handleInvite(pending);
        const joined = this.peers.get(peer);
        if (joined) {
          const group = (await client.groups.get(joined.groupId)) as Group;
          if (group.status === 'active') return group;
        }
      }
      return this.createGroup(peer, existing);
    });
  }

  private async createGroup(peer: string, replacing?: PeerIndexEntry): Promise<Group> {
    const client = this.requireClient();
    const packages = await this.fetchKeyPackages(peer);
    if (packages.length === 0) throw new PeerNotOnChatError(peer);

    let lastError: unknown;
    for (const keyPackage of packages.slice(0, MAX_INVITE_ATTEMPTS)) {
      const group = (await client.groups.create('', { relays: this.relays(), adminPubkeys: [this.me, peer] })) as Group;
      try {
        if (!group.evaluateKeyPackage(keyPackage as NostrEvent).eligible) {
          await client.groups.destroy(group.id);
          continue;
        }
        const results = await client.groups.invite(group.id, keyPackage as NostrEvent);
        if (!Object.values(results).some(r => r.ok)) throw new Error('no relay accepted the invite');
        const entry: PeerIndexEntry = {
          peer,
          groupId: bytesToHex(group.id),
          createdBy: this.me,
          createdAt: this.now(),
          previous: replacing ? [replacing.groupId, ...replacing.previous] : [],
          unread: replacing?.unread ?? 0,
          lastMessage: replacing?.lastMessage,
        };
        await this.savePeer(entry);
        this.emit('index');
        return group;
      } catch (e) {
        lastError = e;
        this.log('invite attempt failed', e);
        await client.groups.destroy(group.id).catch(() => undefined);
      }
    }
    throw lastError instanceof Error ? lastError : new PeerNotOnChatError(peer);
  }

  /* -------------------------------------------------------------- invites */

  private onDecrypted = (invite: Rumor): void => {
    this.handleInvite(invite).catch(e => this.log('invite handling failed', e));
  };

  private handleInvite(invite: Rumor): Promise<void> {
    return this.queue.run(async () => {
      const client = this.requireClient();
      const from = invite.pubkey;
      if (from === this.me || this.requests.has(invite.id)) return;

      if (!this.addressForPubkey(from)) {
        const request: MessageRequest = { id: invite.id, from, at: this.now() };
        this.requests.set(invite.id, request);
        await this.stores!.indexStore.setItem(requestKey(invite.id), request);
        this.emit('index');
        return;
      }
      await this.joinFromInvite(client, invite);
    });
  }

  private async joinFromInvite(client: MarmotClient<GroupRumorHistory, undefined>, invite: Rumor): Promise<void> {
    const from = invite.pubkey;
    const existing = this.peers.get(from);
    let raceReplace = false;

    if (existing) {
      const canonical = this.me < from ? this.me : from;
      const recent = this.now() - existing.createdAt <= RACE_WINDOW_SECONDS;
      // Both sides created a group at once: keep the one created by the lower pubkey, drop the other.
      // An older group means the peer lost its state and is re-inviting, so the new group replaces it.
      if (recent && existing.createdBy === canonical) {
        await client.invites.markAsRead(invite.id);
        return;
      }
      raceReplace = recent;
    }

    if (!(await client.canJoinInvite(invite))) {
      await client.invites.markAsRead(invite.id);
      return;
    }

    const { group } = await client.joinGroupFromWelcome({ welcomeRumor: invite });
    const members = (group as Group).snapshot.members;
    if (members.length !== 2 || !members.includes(this.me) || !members.includes(from)) {
      this.log('ignoring a group that is not a 1:1 with the inviter');
      await client.groups.leave(group.id).catch(() => undefined);
      await client.invites.markAsRead(invite.id);
      return;
    }

    const entry: PeerIndexEntry = {
      peer: from,
      groupId: bytesToHex(group.id),
      createdBy: from,
      createdAt: this.now(),
      previous: existing ? [existing.groupId, ...existing.previous] : [],
      unread: existing?.unread ?? 0,
      lastMessage: existing?.lastMessage,
    };
    await this.savePeer(entry);
    await client.invites.markAsRead(invite.id);
    this.emit('index');
    this.emit('thread', from);
    if (existing && raceReplace) await this.migrateMessages(existing.groupId, group as Group);

    // Rotate our key packages after use and refresh the group's keys, both best effort.
    try {
      await group.selfUpdate();
    } catch (e) {
      this.log('selfUpdate after join failed', e);
    }
    try {
      for (const kp of (await client.keyPackages.list()).filter(k => k.used)) await client.keyPackages.rotate(kp.keyPackageRef);
    } catch (e) {
      this.log('key package rotation after join failed', e);
    }
  }

  /**
   * After losing a duplicate-group race, re-sends what we wrote in the abandoned group into the kept
   * one. Same rumor ids, so both sides' histories dedupe and the thread shows each message once.
   */
  private async migrateMessages(oldGroupId: string, into: Group): Promise<void> {
    const client = this.requireClient();
    try {
      const old = (await client.groups.get(oldGroupId)) as Group;
      const mine = (await old.history.queryRumors({ kinds: [KIND_CHAT, KIND_PAYMENT_NOTICE, KIND_PAYMENT_REQUEST] })).filter(
        r => r.pubkey === this.me,
      );
      for (const rumor of mine.sort((a, b) => a.created_at - b.created_at)) {
        await client.groups.send(into.id, createApplicationMessageIntent(rumor));
      }
    } catch (e) {
      this.log('could not carry messages over to the kept group', e);
    }
  }

  async acceptRequest(id: string): Promise<void> {
    const client = this.requireClient();
    const request = this.requests.get(id);
    if (!request) return;
    const invite = (await client.invites.getUnread()).find(r => r.id === id);
    this.requests.delete(id);
    await this.stores!.indexStore.removeItem(requestKey(id));
    if (invite) await this.queue.run(() => this.joinFromInvite(client, invite));
    this.emit('index');
  }

  async declineRequest(id: string): Promise<void> {
    const client = this.requireClient();
    this.requests.delete(id);
    await this.stores!.indexStore.removeItem(requestKey(id));
    await client.invites.markAsRead(id);
    this.emit('index');
  }

  /* -------------------------------------------------------------- receiving */

  private async onRumor(group: Group, rumor: Rumor): Promise<void> {
    const parsed = parseRumor(rumor);
    if (!parsed) return;
    const peer = this.peerOf(group);
    const mine = rumor.pubkey === this.me;
    if (!peer || (!mine && rumor.pubkey !== peer)) return;
    // Only 1:1 groups the index knows about: anything else is not ours to show.
    const entry = this.peers.get(peer);
    if (!entry || (entry.groupId !== bytesToHex(group.id) && !entry.previous.includes(bytesToHex(group.id)))) return;

    if (parsed.type === 'notice') this.noticePeers.set(rumor.id, peer);

    const net = parsed.type === 'notice' ? parsed.notice.net : parsed.type === 'request' ? parsed.request.net : this.opts.networkId;
    if (net !== this.opts.networkId) return;

    if (parsed.type === 'receipt') {
      this.emit('thread', peer);
      return;
    }

    const last = this.lastMessageOf(parsed, mine);
    const latest = this.peers.get(peer) ?? entry;
    await this.savePeer({
      ...latest,
      unread: mine ? latest.unread : latest.unread + 1,
      lastMessage: !latest.lastMessage || last.at >= latest.lastMessage.at ? last : latest.lastMessage,
    });
    this.emit('index');
    this.emit('thread', peer);

    if (!mine && parsed.type === 'notice') {
      this.emit('notice', { peer, noticeId: rumor.id, notice: parsed.notice, rumor });
    }
  }

  private lastMessageOf(parsed: ParsedChatEvent, mine: boolean): LastMessage {
    const at = parsed.rumor.created_at;
    switch (parsed.type) {
      case 'text':
        return { kind: 'text', text: parsed.text.slice(0, PREVIEW_LENGTH), at, mine };
      case 'notice':
        return { kind: 'notice', amount: parsed.notice.amount, at, mine };
      case 'request':
        return { kind: 'request', amount: parsed.request.amount, at, mine };
      default:
        return { kind: 'text', text: '', at, mine };
    }
  }

  /* -------------------------------------------------------------- thread */

  private async groupsFor(entry: PeerIndexEntry): Promise<Group[]> {
    const client = this.requireClient();
    const out: Group[] = [];
    for (const id of [entry.groupId, ...entry.previous]) {
      try {
        out.push((await client.groups.get(id)) as Group);
      } catch {
        // A group whose state is gone has no history to read.
      }
    }
    return out;
  }

  /** The messages and cards of a conversation, newest first (ready for an inverted list). */
  async getThread(peer: string, limit = 200): Promise<ThreadItem[]> {
    const entry = this.peers.get(peer);
    if (!entry) return [];
    const groups = await this.groupsFor(entry);
    const rumors = new Map<string, Rumor>();
    for (const group of groups) {
      for (const r of await group.history.queryRumors({
        kinds: [KIND_CHAT, KIND_PAYMENT_NOTICE, KIND_PAYMENT_RECEIPT, KIND_PAYMENT_REQUEST],
      }))
        rumors.set(r.id, r);
    }

    const receipts = new Map<string, PaymentReceipt['status'][]>();
    const paidRequests = new Set<string>();
    const parsedAll: ParsedChatEvent[] = [];
    for (const rumor of rumors.values()) {
      const parsed = parseRumor(rumor);
      if (!parsed) continue;
      if (rumor.pubkey !== this.me && rumor.pubkey !== peer) continue;
      parsedAll.push(parsed);
      if (parsed.type === 'receipt') receipts.set(parsed.noticeId, [...(receipts.get(parsed.noticeId) ?? []), parsed.receipt.status]);
      if (parsed.type === 'notice' && parsed.requestId) paidRequests.add(parsed.requestId);
    }

    const items: ThreadItem[] = [];
    for (const parsed of parsedAll) {
      const { rumor } = parsed;
      const mine = rumor.pubkey === this.me;
      if (parsed.type === 'text') items.push({ kind: 'text', id: rumor.id, mine, at: rumor.created_at, text: parsed.text });
      else if (parsed.type === 'notice') {
        if (parsed.notice.net !== this.opts.networkId) continue;
        const card = this.cards.get(rumor.id);
        const seen = receipts.get(rumor.id) ?? [];
        const status: IncomingNoticeStatus | OutgoingNoticeStatus = mine
          ? card?.status === 'confirmed' || seen.includes('confirmed')
            ? 'confirmed'
            : seen.length > 0 || card?.status === 'received'
              ? 'received'
              : 'sent'
          : (card?.status ?? 'verifying');
        items.push({
          kind: 'notice',
          id: rumor.id,
          mine,
          at: rumor.created_at,
          notice: parsed.notice,
          status,
          amount: mine ? parsed.notice.amount : card?.amount,
          requestId: parsed.requestId,
        });
      } else if (parsed.type === 'request') {
        if (parsed.request.net !== this.opts.networkId) continue;
        const declined = (await this.stores!.indexStore.getItem(REQUEST_RESPONSE_KEY(rumor.id))) === 'declined';
        const expired = parsed.request.exp !== undefined && parsed.request.exp < this.now();
        const status: RequestStatus = paidRequests.has(rumor.id) ? 'paid' : declined ? 'declined' : expired ? 'expired' : 'open';
        items.push({ kind: 'request', id: rumor.id, mine, at: rumor.created_at, request: parsed.request, status });
      }
    }
    items.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    return items.slice(0, limit);
  }

  /* -------------------------------------------------------------- sending */

  private async sendRumor(peer: string, rumor: Rumor): Promise<void> {
    const group = await this.ensureGroup(peer);
    await this.requireClient().groups.send(group.id, createApplicationMessageIntent(rumor));
  }

  /** A contact's silent payment address or a raw chat pubkey (someone who is not a contact), as a pubkey. */
  resolvePeer(target: string): string | undefined {
    return /^[0-9a-f]{64}$/.test(target) ? target : this.pubkeyForAddress(target);
  }

  private requirePeer(target: string): string {
    const peer = this.resolvePeer(target);
    if (!peer) throw new Error('not a silent payment address on this network');
    return peer;
  }

  async sendText(address: string, text: string): Promise<Rumor> {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) throw new Error('message is empty or too long');
    const peer = this.requirePeer(address);
    const rumor = buildChatRumor(this.me, trimmed, this.now());
    await this.sendRumor(peer, rumor);
    return rumor;
  }

  /** Tells the payee about a payment we just broadcast. The notice id is the returned rumor's id. */
  async sendNotice(address: string, notice: Omit<PaymentNotice, 'v' | 'net'>, requestId?: string): Promise<Rumor> {
    const peer = this.requirePeer(address);
    const rumor = buildNoticeRumor(this.me, { ...notice, net: this.opts.networkId }, requestId, this.now());
    this.noticePeers.set(rumor.id, peer);
    await this.sendRumor(peer, rumor);
    this.emit('noticeSent', { peer, noticeId: rumor.id, txid: notice.txid });
    return rumor;
  }

  /** Notices still short of Confirmed, across every conversation: what to pick back up after a restart. */
  async listPendingNotices(): Promise<PendingNotice[]> {
    const out: PendingNotice[] = [];
    for (const peer of this.peers.keys()) {
      for (const item of await this.getThread(peer)) {
        if (item.kind === 'notice' && item.status !== 'confirmed') {
          out.push({ peer, noticeId: item.id, mine: item.mine, notice: item.notice, status: item.status, amount: item.amount });
        }
      }
    }
    return out;
  }

  async sendReceipt(peer: string, noticeId: string, status: ReceiptStatus, txid: string, amount: number): Promise<Rumor> {
    const rumor = buildReceiptRumor(this.me, { txid, status, amount }, noticeId, this.now());
    await this.sendRumor(peer, rumor);
    return rumor;
  }

  async sendRequest(address: string, request: Omit<PaymentRequest, 'v' | 'net'>): Promise<Rumor> {
    const peer = this.requirePeer(address);
    const rumor = buildRequestRumor(this.me, { ...request, net: this.opts.networkId }, this.now());
    await this.sendRumor(peer, rumor);
    return rumor;
  }
}
