import type { NostrEvent } from 'applesauce-core/helpers/event';
import type { Filter } from 'applesauce-core/helpers/filter';
import type { NostrNetworkInterface, PublishResponse, Subscribable } from '@internet-privacy/marmot-ts/client';

type Sub = { filters: Filter[]; next: (ev: NostrEvent) => void };

const isReplaceable = (kind: number): boolean => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
const isAddressable = (kind: number): boolean => kind >= 30000 && kind < 40000;
const dTag = (ev: NostrEvent): string => ev.tags.find(t => t[0] === 'd')?.[1] ?? '';

/** Whether `ev` satisfies a NIP-01 filter (kinds, authors, ids, #tags, since, until). `limit` is applied by the caller. */
export function matchesFilter(ev: NostrEvent, f: Filter): boolean {
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.since !== undefined && ev.created_at < f.since) return false;
  if (f.until !== undefined && ev.created_at > f.until) return false;
  for (const [key, values] of Object.entries(f)) {
    if (!key.startsWith('#') || !Array.isArray(values)) continue;
    const name = key.slice(1);
    if (!ev.tags.some(t => t[0] === name && (values as string[]).includes(t[1]))) return false;
  }
  return true;
}

/**
 * A single in-memory relay behind marmot-ts's `NostrNetworkInterface`. Replays stored matches to a
 * new subscription, then streams new events; replaceable and addressable kinds keep only the newest
 * event per slot, as a real relay would. Shared by the on-device self-test and the jest suites.
 */
export class InMemoryRelay implements NostrNetworkInterface {
  readonly events: NostrEvent[] = [];
  private subs = new Set<Sub>();
  /** Every event ever published, in order; used to assert what a relay would have seen. */
  readonly published: NostrEvent[] = [];

  constructor(private readonly inboxRelays: string[] = ['wss://memory.relay']) {}

  async publish(relays: string[], event: NostrEvent): Promise<Record<string, PublishResponse>> {
    this.published.push(event);
    this.store(event);
    for (const sub of [...this.subs]) {
      if (sub.filters.some(f => matchesFilter(event, f))) sub.next(event);
    }
    const out: Record<string, PublishResponse> = {};
    for (const url of relays) out[url] = { from: url, ok: true };
    return out;
  }

  private store(event: NostrEvent): void {
    if (this.events.some(e => e.id === event.id)) return;
    if (isReplaceable(event.kind) || isAddressable(event.kind)) {
      const slot = (e: NostrEvent) =>
        e.kind === event.kind && e.pubkey === event.pubkey && (!isAddressable(event.kind) || dTag(e) === dTag(event));
      const existing = this.events.findIndex(slot);
      if (existing >= 0) {
        if (this.events[existing].created_at > event.created_at) return;
        this.events.splice(existing, 1);
      }
    }
    this.events.push(event);
  }

  private query(filters: Filter | Filter[]): NostrEvent[] {
    const list = Array.isArray(filters) ? filters : [filters];
    const seen = new Set<string>();
    const out: NostrEvent[] = [];
    for (const f of list) {
      let matched = this.events.filter(e => matchesFilter(e, f)).sort((a, b) => b.created_at - a.created_at);
      if (f.limit !== undefined) matched = matched.slice(0, f.limit);
      for (const e of matched) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    }
    return out;
  }

  async request(_relays: string[], filters: Filter | Filter[]): Promise<NostrEvent[]> {
    return this.query(filters);
  }

  subscription(_relays: string[], filters: Filter | Filter[]): Subscribable<NostrEvent> {
    const list = Array.isArray(filters) ? filters : [filters];
    return {
      subscribe: observer => {
        const sub: Sub = { filters: list, next: ev => observer.next?.(ev) };
        // Replay is async so the subscriber has its handle before the first event arrives.
        const replay = this.query(list).reverse();
        const timer = setTimeout(() => {
          if (!this.subs.has(sub)) return;
          for (const ev of replay) sub.next(ev);
        }, 0);
        this.subs.add(sub);
        return {
          unsubscribe: () => {
            clearTimeout(timer);
            this.subs.delete(sub);
          },
        };
      },
    };
  }

  async getUserInboxRelays(pubkey: string): Promise<string[]> {
    const ev = this.events.find(e => e.kind === 10050 && e.pubkey === pubkey);
    const fromEvent = ev?.tags.filter(t => t[0] === 'relay').map(t => t[1]);
    return fromEvent && fromEvent.length > 0 ? fromEvent : this.inboxRelays;
  }
}
