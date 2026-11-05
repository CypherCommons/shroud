import { Buffer } from 'buffer';
import {
  ChatKeyValueStore,
  createChatStores,
  decodeValue,
  deriveStoreKey,
  encodeValue,
  open,
  seal,
  storePrefix,
  wipeChatStorage,
  type StorageBackend,
} from '../../helpers/chat/storage';

class MapBackend implements StorageBackend {
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

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const SECRET_A = new Uint8Array(32).fill(1);
const SECRET_B = new Uint8Array(32).fill(2);

describe('tagged JSON codec', () => {
  it('round-trips Uint8Array, bigint, and nesting', () => {
    const value = {
      bytes: new Uint8Array([0, 1, 2, 255]),
      big: 2n ** 80n + 7n,
      neg: -5n,
      nested: { list: [new Uint8Array([9]), 1, 'x', null, true], deep: { b: 123n } },
      plain: 'text',
      n: 1.5,
    };
    const back = decodeValue<typeof value>(encodeValue(value));
    expect(back.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.bytes)).toEqual([0, 1, 2, 255]);
    expect(back.big).toBe(2n ** 80n + 7n);
    expect(back.neg).toBe(-5n);
    expect(back.nested.deep.b).toBe(123n);
    expect(Array.from(back.nested.list[0] as Uint8Array)).toEqual([9]);
    expect(back.nested.list.slice(1)).toEqual([1, 'x', null, true]);
    expect(back.plain).toBe('text');
    expect(back.n).toBe(1.5);
  });

  it('encodes a Buffer (whose own toJSON would corrupt it) as bytes, not {type:"Buffer"}', () => {
    const text = encodeValue({ b: Buffer.from([7, 8, 9]) });
    expect(text).not.toContain('"Buffer"');
    expect(Array.from(decodeValue<{ b: Uint8Array }>(text).b)).toEqual([7, 8, 9]);
  });

  it('round-trips an empty array and an empty Uint8Array', () => {
    expect(decodeValue<{ a: unknown[]; b: Uint8Array }>(encodeValue({ a: [], b: new Uint8Array(0) }))).toEqual({
      a: [],
      b: new Uint8Array(0),
    });
  });

  it('leaves ordinary single-key objects alone', () => {
    expect(decodeValue(encodeValue({ $u8: 5 }))).toEqual({ $u8: 5 });
    expect(decodeValue(encodeValue({ x: 1 }))).toEqual({ x: 1 });
  });
});

describe('encryption at rest', () => {
  const key = deriveStoreKey(SECRET_A);

  it('derives a 32-byte key per secret, deterministically', () => {
    expect(key).toHaveLength(32);
    expect(Array.from(deriveStoreKey(SECRET_A))).toEqual(Array.from(key));
    expect(Array.from(deriveStoreKey(SECRET_B))).not.toEqual(Array.from(key));
  });

  it('seals and opens, with a fresh nonce on every write', () => {
    const a = seal(key, 'k', 'hello');
    const b = seal(key, 'k', 'hello');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('hello');
    expect(open(key, 'k', a)).toBe('hello');
    expect(open(key, 'k', b)).toBe('hello');
  });

  it('refuses the wrong key, a different storage key (AAD), a tampered value and an unknown format', () => {
    const sealed = seal(key, 'k', 'secret');
    expect(() => open(deriveStoreKey(SECRET_B), 'k', sealed)).toThrow();
    expect(() => open(key, 'other', sealed)).toThrow();
    const flipped = sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => open(key, 'k', flipped)).toThrow();
    expect(() => open(key, 'k', 'v9.abcd')).toThrow(/unknown format/);
    expect(() => open(key, 'k', 'v1.AA==')).toThrow(/too short/);
  });
});

describe('ChatKeyValueStore', () => {
  it('stores namespaced, encrypted values and strips the prefix from keys()', async () => {
    const backend = new MapBackend();
    const store = new ChatKeyValueStore<{ n: bigint; b: Uint8Array }>(backend, PK_A, 'group-state', deriveStoreKey(SECRET_A));
    await store.setItem('g:1', { n: 5n, b: new Uint8Array([1, 2]) });
    await store.setItem('g2', { n: 6n, b: new Uint8Array() });

    expect([...backend.map.keys()].sort()).toEqual(
      [`${storePrefix(PK_A, 'group-state')}g2`, `${storePrefix(PK_A, 'group-state')}g:1`].sort(),
    );
    for (const v of backend.map.values()) expect(v.startsWith('v1.')).toBe(true);

    expect((await store.keys()).sort()).toEqual(['g2', 'g:1']);
    const got = await store.getItem('g:1');
    expect(got?.n).toBe(5n);
    expect(Array.from(got!.b)).toEqual([1, 2]);
    expect(await store.getItem('missing')).toBeNull();

    await store.removeItem('g2');
    expect(await store.keys()).toEqual(['g:1']);
    await store.clear();
    expect(await store.keys()).toEqual([]);
  });

  it('keeps stores and wallets apart', async () => {
    const backend = new MapBackend();
    const a1 = new ChatKeyValueStore<string>(backend, PK_A, 's1', deriveStoreKey(SECRET_A));
    const a2 = new ChatKeyValueStore<string>(backend, PK_A, 's2', deriveStoreKey(SECRET_A));
    const b1 = new ChatKeyValueStore<string>(backend, PK_B, 's1', deriveStoreKey(SECRET_B));
    await a1.setItem('k', 'a1');
    await a2.setItem('k', 'a2');
    await b1.setItem('k', 'b1');
    expect(await a1.getItem('k')).toBe('a1');
    expect(await a2.getItem('k')).toBe('a2');
    expect(await b1.getItem('k')).toBe('b1');
    expect(await b1.keys()).toEqual(['k']);
    await a1.clear();
    expect(await a2.getItem('k')).toBe('a2');
    expect(await b1.getItem('k')).toBe('b1');
  });

  it("treats a decoy bucket's key as unable to read the real bucket's data, and reports it", async () => {
    const backend = new MapBackend();
    await new ChatKeyValueStore<string>(backend, PK_A, 's', deriveStoreKey(SECRET_A)).setItem('k', 'real');
    const onCorrupt = jest.fn();
    // Same namespace but another wallet's key: reads as absent instead of throwing or leaking.
    const wrong = new ChatKeyValueStore<string>(backend, PK_A, 's', deriveStoreKey(SECRET_B), onCorrupt);
    expect(await wrong.getItem('k')).toBeNull();
    expect(onCorrupt).toHaveBeenCalledTimes(1);
  });
});

describe('createChatStores', () => {
  it('persists one clientId per pubkey and exposes durable stores plus a per-group history', async () => {
    const backend = new MapBackend();
    const first = await createChatStores(backend, PK_A, SECRET_A);
    expect(first.clientId).toMatch(/^[0-9a-f]{64}$/);
    const again = await createChatStores(backend, PK_A, SECRET_A);
    expect(again.clientId).toBe(first.clientId);
    const other = await createChatStores(backend, PK_B, SECRET_B);
    expect(other.clientId).not.toBe(first.clientId);

    await first.indexStore.setItem('peer', { groupId: 'abc', unread: 2 });
    expect(await again.indexStore.getItem('peer')).toEqual({ groupId: 'abc', unread: 2 });

    const groupA = new Uint8Array([1, 2, 3]);
    const groupB = new Uint8Array([4, 5, 6]);
    const hA = first.historyFactory(groupA);
    const rumor: any = { id: '1'.repeat(64), pubkey: PK_A, created_at: 10, kind: 9, tags: [], content: 'hi' };
    await hA.saveRumor(rumor);
    expect(await hA.queryRumors({ kinds: [9] })).toHaveLength(1);
    expect(await first.historyFactory(groupB).queryRumors({ kinds: [9] })).toHaveLength(0);
    // A new factory (an app restart) still sees it.
    expect(await again.historyFactory(groupA).queryRumors({ kinds: [9] })).toHaveLength(1);
  });

  it('regenerates a corrupt clientId and wipes everything a wallet owns', async () => {
    const backend = new MapBackend();
    const s = await createChatStores(backend, PK_A, SECRET_A);
    await new ChatKeyValueStore<string>(backend, PK_A, 'meta', deriveStoreKey(SECRET_A)).setItem('clientId', 'not-hex');
    const fixed = await createChatStores(backend, PK_A, SECRET_A);
    expect(fixed.clientId).toMatch(/^[0-9a-f]{64}$/);
    expect(fixed.clientId).not.toBe(s.clientId);

    await createChatStores(backend, PK_B, SECRET_B);
    await wipeChatStorage(backend, PK_A);
    expect([...backend.map.keys()].every(k => k.startsWith(`shroud-chat:${PK_B}:`))).toBe(true);
    expect(backend.map.size).toBeGreaterThan(0);
  });
});
