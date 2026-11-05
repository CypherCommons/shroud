import {
  MarmotClient,
  GroupRumorHistory,
  createChatRumor,
  createApplicationMessageIntent,
  deserializeApplicationData,
  type MarmotGroup,
} from '@internet-privacy/marmot-ts';
import { InMemoryKeyValueStore, KeyValueRumorHistoryBackend } from '@internet-privacy/marmot-ts/extra';
import { nobleCryptoProvider } from '@internet-privacy/marmot-ts/mls';
import { unlockGiftWrap, type Rumor } from 'applesauce-common/helpers/gift-wrap';
import { getEventHash, type NostrEvent } from 'applesauce-core/helpers/event';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { InMemoryRelay } from './inMemoryRelay';
import { KIND_CHAT, KIND_GIFT_WRAP, KIND_GROUP_MESSAGE, KIND_KEY_PACKAGE, KIND_PAYMENT_NOTICE, KIND_PAYMENT_RECEIPT } from './kinds';

export interface SelfTestStep {
  name: string;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface SelfTestResult {
  ok: boolean;
  steps: SelfTestStep[];
  totalMs: number;
  /** True when the runtime already had a native `crypto.subtle` (the noble shim was not exercised). */
  hasNativeSubtle: boolean;
}

const RELAYS = ['wss://memory.relay'];

const nowMs = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const makeRumor = (pubkey: string, kind: number, content: string, tags: string[][]): Rumor => {
  const r = { id: '', pubkey, created_at: Math.floor(Date.now() / 1000), kind, tags, content };
  r.id = getEventHash(r);
  return r as Rumor;
};

const makeClient = (signer: PrivateKeySigner, relay: InMemoryRelay) =>
  new MarmotClient({
    signer,
    network: relay,
    cryptoProvider: nobleCryptoProvider,
    groupStateStore: new InMemoryKeyValueStore(),
    keyPackageStore: new InMemoryKeyValueStore(),
    clientId: bytesToHex(randomBytes(32)),
    historyFactory: () => new GroupRumorHistory(new KeyValueRumorHistoryBackend(new InMemoryKeyValueStore<Rumor>())),
  });

/**
 * End-to-end Marmot flow between two in-memory clients and an in-memory relay: key package → 1:1
 * group → invite (gift-wrapped Welcome) → join → kind-9 chat → payment notice → receipt. Runs on
 * the real JS engine, so on a device it proves marmot-ts and the crypto shim work under Hermes.
 */
export async function runChatSelfTest(): Promise<SelfTestResult> {
  const steps: SelfTestStep[] = [];
  const startedAt = nowMs();
  const hasNativeSubtle = !!(globalThis as any).crypto?.subtle && (globalThis as any).crypto.subtle.constructor?.name !== 'Object';

  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = nowMs();
    try {
      const out = await fn();
      steps.push({ name, ms: Math.round(nowMs() - t0), ok: true });
      return out;
    } catch (e: any) {
      steps.push({
        name,
        ms: Math.round(nowMs() - t0),
        ok: false,
        error: e?.stack ? `${e.message}\n${String(e.stack).split('\n').slice(0, 4).join('\n')}` : String(e),
      });
      throw e;
    }
  };

  const finish = (): SelfTestResult => ({ ok: steps.every(s => s.ok), steps, totalMs: Math.round(nowMs() - startedAt), hasNativeSubtle });

  try {
    const relay = new InMemoryRelay(RELAYS);
    const aliceSigner = new PrivateKeySigner();
    const bobSigner = new PrivateKeySigner();
    const alicePk = await aliceSigner.getPublicKey();
    const bobPk = await bobSigner.getPublicKey();
    const alice = makeClient(aliceSigner, relay);
    const bob = makeClient(bobSigner, relay);

    await step('Bob publishes key package (kind 30443)', () => bob.keyPackages.create({ relays: RELAYS }));

    const group = await step('Alice creates a 1:1 group', () =>
      alice.groups.create('', { relays: RELAYS, adminPubkeys: [alicePk, bobPk] }),
    );

    await step('Alice invites Bob (commit + gift-wrapped Welcome)', async () => {
      const [kp] = await relay.request(RELAYS, { kinds: [KIND_KEY_PACKAGE], authors: [bobPk] });
      if (!kp) throw new Error('no key package on relay');
      await alice.groups.invite(group.id, kp);
    });

    const bobGroup: MarmotGroup<GroupRumorHistory> = await step('Bob unwraps the invite and joins', async () => {
      const [wrap] = await relay.request(RELAYS, { kinds: [KIND_GIFT_WRAP], '#p': [bobPk] });
      if (!wrap) throw new Error('no gift wrap for Bob');
      const welcomeRumor = await unlockGiftWrap(wrap, bobSigner);
      return (await bob.joinGroupFromWelcome({ welcomeRumor })).group;
    });

    const nostrGroupId = bytesToHex(group.groupData!.nostrGroupId!);
    const delivered = new Map<string, Rumor[]>();
    const deliver = async (to: MarmotGroup<GroupRumorHistory>, bucket: string): Promise<Rumor[]> => {
      const evs = await relay.request(RELAYS, { kinds: [KIND_GROUP_MESSAGE], '#h': [nostrGroupId] });
      const got: Rumor[] = [];
      const onMessage = (data: Uint8Array) => got.push(deserializeApplicationData(data) as unknown as Rumor);
      to.on('applicationMessage', onMessage);
      try {
        for await (const r of to.ingest(evs as NostrEvent[])) {
          if (r.kind === 'unreadable') throw new Error(`unreadable event: ${JSON.stringify(r).slice(0, 200)}`);
        }
      } finally {
        to.off('applicationMessage', onMessage);
      }
      delivered.set(bucket, got);
      return got;
    };

    await step('Alice sends a kind-9 chat message', async () => {
      await alice.groups.send(group.id, createApplicationMessageIntent(createChatRumor({ pubkey: alicePk, content: 'dinner money 🍕' })));
    });

    const txid = 'a'.repeat(64);
    const tweak = '02' + 'b'.repeat(64);
    await step('Alice sends a payment notice (kind 8352)', async () => {
      await alice.groups.send(
        group.id,
        createApplicationMessageIntent(
          makeRumor(alicePk, KIND_PAYMENT_NOTICE, JSON.stringify({ v: 1, net: 'signet', txid, tweak, amount: 50000 }), [
            ['alt', 'Sent you 50,000 sats'],
          ]),
        ),
      );
    });

    await step('Bob decrypts chat + notice', async () => {
      const got = await deliver(bobGroup, 'bob');
      const chat = got.find(r => r.kind === KIND_CHAT);
      const notice = got.find(r => r.kind === KIND_PAYMENT_NOTICE);
      if (!chat || chat.content !== 'dinner money 🍕') throw new Error(`chat missing or wrong: ${JSON.stringify(chat)}`);
      if (!notice || JSON.parse(notice.content).txid !== txid) throw new Error(`notice missing or wrong: ${JSON.stringify(notice)}`);
      if (chat.pubkey !== alicePk || notice.pubkey !== alicePk) throw new Error('rumor pubkey is not the MLS sender');
    });

    await step('Bob sends a receipt (kind 8353)', async () => {
      const notice = delivered.get('bob')!.find(r => r.kind === KIND_PAYMENT_NOTICE)!;
      await bob.groups.send(
        bobGroup.id,
        createApplicationMessageIntent(
          makeRumor(bobPk, KIND_PAYMENT_RECEIPT, JSON.stringify({ v: 1, txid, status: 'detected', amount: 50000 }), [
            ['e', notice.id],
            ['alt', 'Received 50,000 sats'],
          ]),
        ),
      );
    });

    await step('Alice decrypts the receipt', async () => {
      const got = await deliver(group as MarmotGroup<GroupRumorHistory>, 'alice');
      const receipt = got.find(r => r.kind === KIND_PAYMENT_RECEIPT);
      if (!receipt || JSON.parse(receipt.content).status !== 'detected')
        throw new Error(`receipt missing or wrong: ${JSON.stringify(receipt)}`);
      if (receipt.pubkey !== bobPk) throw new Error('receipt pubkey is not Bob');
    });

    await step('Relay only saw kinds 30443 / 445 / 1059, fresh signer per 445', async () => {
      const kinds = new Set(relay.published.map(e => e.kind));
      for (const k of kinds)
        if (![KIND_KEY_PACKAGE, KIND_GROUP_MESSAGE, KIND_GIFT_WRAP].includes(k)) throw new Error(`unexpected kind ${k} on relay`);
      const signers445 = relay.published.filter(e => e.kind === KIND_GROUP_MESSAGE).map(e => e.pubkey);
      if (signers445.length === 0) throw new Error('no kind 445 published');
      if (new Set(signers445).size !== signers445.length) throw new Error('kind 445 signer reused');
      if (signers445.includes(alicePk) || signers445.includes(bobPk)) throw new Error('kind 445 signed with a real identity');
    });
  } catch {
    // The failing step is already recorded with its error.
  }
  return finish();
}
