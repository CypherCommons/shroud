import { InMemoryRelay } from '../../helpers/chat/inMemoryRelay';
import { ChatService } from '../../helpers/chat/ChatService';
import { deriveChatIdentity } from '../../helpers/chat/identity';
import type { StorageBackend } from '../../helpers/chat/storage';
import { getNetwork } from '../../modules/network';

export const RELAYS = ['wss://memory.relay'];
export const SIGNET = getNetwork('signet');

// Rumor timestamps are whole seconds, so messages in one test would tie and sort by id. A strictly
// increasing clock keeps the order the test sends in.
let clock = Math.floor(Date.now() / 1000);
export const tick = () => clock++;

export class MapBackend implements StorageBackend {
  readonly map = new Map<string, string>();
  async getItem(k: string) {
    return this.map.get(k) ?? null;
  }

  async setItem(k: string, v: string) {
    this.map.set(k, v);
  }

  async removeItem(k: string) {
    this.map.delete(k);
  }

  async getAllKeys() {
    return [...this.map.keys()];
  }
}

export async function waitFor<T>(
  fn: () => Promise<T | undefined | false> | T | undefined | false,
  what: string,
  timeoutMs = 8000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

export interface User {
  name: string;
  identity: ReturnType<typeof deriveChatIdentity>;
  backend: MapBackend;
  contacts: string[];
  service: ChatService;
  make: (networkId?: string) => ChatService;
}

export function makeUser(name: string, seedByte: number, relay: InMemoryRelay, networkId = 'signet'): User {
  const identity = deriveChatIdentity(Buffer.alloc(64, seedByte), SIGNET);
  const backend = new MapBackend();
  const user: User = {
    name,
    identity,
    backend,
    contacts: [],
    service: undefined as unknown as ChatService,
    make: (net = networkId) =>
      new ChatService({
        identity,
        network: relay,
        backend,
        networkId: net,
        bitcoinNetwork: SIGNET.bitcoinjs,
        getContactAddresses: () => user.contacts,
        getRelays: () => RELAYS,
        now: tick,
        log: (m, e) => {
          if (process.env.CHAT_TEST_LOG) console.log(`[${name}] ${m}`, e ?? '');
        },
      }),
  };
  user.service = user.make();
  return user;
}
