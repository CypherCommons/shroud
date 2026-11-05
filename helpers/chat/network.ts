import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools/core';
import { getInboxRelays } from '@internet-privacy/marmot-ts';
import type { NostrNetworkInterface, PublishResponse, Subscribable } from '@internet-privacy/marmot-ts/client';
import type { NostrEvent } from 'applesauce-core/helpers/event';
import type { Filter } from 'applesauce-core/helpers/filter';
import { KIND_INBOX_RELAY_LIST } from './kinds';
import { getChatRelays } from './relays';

export interface ChatNetworkOptions {
  /** The chat identity's secret: answers NIP-42 AUTH challenges (some relays gate kind 1059 behind it). */
  secretKey?: Uint8Array;
  /** Relays to read inbox lists from and fall back to. Defaults to the shared chat relay list. */
  defaultRelays?: () => string[];
  /** How long a request or publish waits on slow relays. */
  maxWaitMs?: number;
  /** Test seam: a pool to use instead of a real WebSocket one. */
  pool?: SimplePool;
}

const INBOX_CACHE_MS = 5 * 60 * 1000;

const unique = (relays: string[]): string[] => [...new Set(relays)];
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * marmot-ts's network interface over nostr-tools' SimplePool (React Native's WebSocket). Reconnects
 * and pings are on, since chat runs in the foreground over mobile networks that drop sockets.
 */
export class ChatNetwork implements NostrNetworkInterface {
  readonly pool: SimplePool;
  private readonly defaultRelays: () => string[];
  private readonly maxWait: number;
  private readonly auth?: (evt: EventTemplate) => Promise<ReturnType<typeof finalizeEvent>>;
  private readonly inboxCache = new Map<string, { relays: string[]; at: number }>();

  constructor(options: ChatNetworkOptions = {}) {
    this.pool = options.pool ?? new SimplePool({ enablePing: true, enableReconnect: true });
    this.defaultRelays = options.defaultRelays ?? getChatRelays;
    this.maxWait = options.maxWaitMs ?? 8000;
    const sk = options.secretKey;
    if (sk) {
      this.auth = async (evt: EventTemplate) => finalizeEvent(evt, sk);
      this.pool.automaticallyAuth = () => this.auth!;
    }
  }

  async publish(relays: string[], event: NostrEvent): Promise<Record<string, PublishResponse>> {
    const targets = unique(relays);
    const out: Record<string, PublishResponse> = {};
    const pending = this.pool.publish(targets, event as any, { maxWait: this.maxWait, onauth: this.auth });
    await Promise.all(
      targets.map(async (url, i) => {
        try {
          const msg = String(await pending[i]);
          const soft = msg.startsWith('connection failure:');
          out[url] = { from: url, ok: !soft, message: soft ? msg : msg || undefined };
        } catch (err) {
          const message = messageOf(err);
          // A timeout fires after the bytes were sent, so the relay may still have accepted the event.
          out[url] = { from: url, ok: false, message, uncertain: /timed out/i.test(message) || undefined };
        }
      }),
    );
    return out;
  }

  async request(relays: string[], filters: Filter | Filter[]): Promise<NostrEvent[]> {
    const targets = unique(relays);
    const list = Array.isArray(filters) ? filters : [filters];
    const batches = await Promise.all(list.map(f => this.pool.querySync(targets, f as any, { maxWait: this.maxWait }).catch(() => [])));
    const seen = new Set<string>();
    const events: NostrEvent[] = [];
    for (const e of batches.flat()) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        events.push(e as NostrEvent);
      }
    }
    return events;
  }

  subscription(relays: string[], filters: Filter | Filter[]): Subscribable<NostrEvent> {
    const targets = unique(relays);
    const list = Array.isArray(filters) ? filters : [filters];
    return {
      subscribe: observer => {
        const subs = list.map(f =>
          this.pool.subscribe(targets, f as any, {
            onevent: ev => observer.next?.(ev as NostrEvent),
          }),
        );
        return { unsubscribe: () => subs.forEach(s => s.close()) };
      },
    };
  }

  async getUserInboxRelays(pubkey: string): Promise<string[]> {
    const cached = this.inboxCache.get(pubkey);
    if (cached && Date.now() - cached.at < INBOX_CACHE_MS) return cached.relays;
    const defaults = this.defaultRelays();
    let relays = defaults;
    try {
      const ev = await this.pool.get(defaults, { kinds: [KIND_INBOX_RELAY_LIST], authors: [pubkey], limit: 1 }, { maxWait: this.maxWait });
      const listed = ev ? getInboxRelays(ev as NostrEvent) : [];
      if (listed.length > 0) relays = listed;
    } catch {
      // Fall back to the shared list: better to deliver to a relay the peer may read than to fail.
    }
    this.inboxCache.set(pubkey, { relays, at: Date.now() });
    return relays;
  }

  /** Closes every relay connection. The pool is unusable afterwards. */
  destroy(): void {
    this.pool.destroy();
  }
}
