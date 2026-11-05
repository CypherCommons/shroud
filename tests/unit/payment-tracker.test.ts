import { webcrypto } from 'crypto';
import { InMemoryRelay } from '../../helpers/chat/inMemoryRelay';
import { nobleSubtle } from '../../helpers/chat/nobleSubtle';
import { type ThreadItem } from '../../helpers/chat/ChatService';
import { PaymentTracker, type ChainPort, type PaymentWalletPort } from '../../helpers/chat/PaymentTracker';
import { RELAYS, makeUser, waitFor, type User } from './chatTestKit';

const TXID = 'ab'.repeat(32);
const TWEAK = '02' + 'cd'.repeat(32);
const AMOUNT = 50_000;

type Detect = Awaited<ReturnType<PaymentWalletPort['detectUnconfirmedPayment']>>;
const MISS: Detect = { found: false, totalValue: 0, confirmations: 0 };
const HIT = (confirmations = 0): Detect => ({ found: true, totalValue: AMOUNT, confirmations });

class FakeWallet implements PaymentWalletPort {
  detect = jest.fn<Promise<Detect>, [{ txid: string; tweak: string; hex?: string }]>(async () => MISS);
  scan = jest.fn<Promise<Detect>, [string]>(async () => MISS);
  detectUnconfirmedPayment(p: { txid: string; tweak: string; hex?: string }) {
    return this.detect(p);
  }

  scanByTxid(txid: string) {
    return this.scan(txid);
  }
}

class FakeChain implements ChainPort {
  confirmations: number | null = 0;
  private listeners = new Set<() => void>();
  getConfirmations = jest.fn(async () => this.confirmations);
  onNewBlock(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A block arrives; resolves once the tracker's pass over it has finished. */
  async mine() {
    this.listeners.forEach(l => l());
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}

const card = async (u: User, peer: string) =>
  (await u.service.getThread(peer)).find(i => i.kind === 'notice') as Extract<ThreadItem, { kind: 'notice' }> | undefined;

describe('PaymentTracker', () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const running: { stop: () => unknown }[] = [];

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: nobleSubtle },
    });
  });
  afterAll(() => {
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  });
  afterEach(async () => {
    for (const r of running.splice(0).reverse()) await r.stop();
  });

  async function setup(opts: { maxWaitingBlocks?: number } = {}) {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay);
    const bob = makeUser('bob', 2, relay);
    alice.contacts = [bob.identity.address];
    bob.contacts = [alice.identity.address];
    for (const u of [alice, bob]) {
      running.push(u.service);
      await u.service.start();
      await u.service.settled();
    }
    const aliceChain = new FakeChain();
    const bobChain = new FakeChain();
    const aliceWallet = new FakeWallet();
    const bobWallet = new FakeWallet();
    const aliceTracker = new PaymentTracker(alice.service, aliceWallet, aliceChain, opts);
    const bobTracker = new PaymentTracker(bob.service, bobWallet, bobChain, opts);
    running.push(aliceTracker, bobTracker);
    await aliceTracker.start();
    await bobTracker.start();
    const pay = () => alice.service.sendNotice(bob.identity.address, { txid: TXID, tweak: TWEAK, amount: AMOUNT, note: 'lunch' });
    return { relay, alice, bob, aliceChain, bobChain, aliceWallet, bobWallet, aliceTracker, bobTracker, pay };
  }

  it('detects at once, answers with a receipt, and both cards confirm after a block', async () => {
    const { alice, bob, bobChain, aliceChain, bobWallet, pay } = await setup();
    bobWallet.detect.mockResolvedValue(HIT(0));

    const notice = await pay();
    // Receiver: Verifying → Pending with the amount its own scan matched.
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'pending', "Bob's card to go pending");
    expect(await card(bob, alice.identity.pubkey)).toMatchObject({ status: 'pending', amount: AMOUNT, mine: false });
    expect(bobWallet.detect).toHaveBeenCalledWith({ txid: TXID, tweak: TWEAK, hex: undefined });
    // Sender: Sent → Received by Bob.
    await waitFor(async () => (await card(alice, bob.identity.pubkey))?.status === 'received', "Alice's card to show received");

    // A block: Electrum now reports a confirmation on both sides.
    bobChain.confirmations = 1;
    aliceChain.confirmations = 1;
    await bobChain.mine();
    await aliceChain.mine();
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'confirmed', "Bob's card to confirm");
    await waitFor(async () => (await card(alice, bob.identity.pubkey))?.status === 'confirmed', "Alice's card to confirm");
    expect(bobWallet.scan).toHaveBeenCalledWith(TXID); // pulled the confirmed height in right away
    expect(notice.id).toBeTruthy();
  }, 30000);

  it('never credits the amount from the message: the card shows the matched amount', async () => {
    const { alice, bob, bobWallet, pay } = await setup();
    bobWallet.detect.mockResolvedValue({ found: true, totalValue: 777, confirmations: 0 });
    await pay(); // the notice claims 50,000
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'pending', 'pending');
    expect((await card(bob, alice.identity.pubkey))?.amount).toBe(777);
  }, 30000);

  it('goes straight to Confirmed when the transaction is already mined, with both receipts', async () => {
    const { alice, bob, bobWallet, pay } = await setup();
    bobWallet.detect.mockResolvedValue(HIT(3));
    await pay();
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'confirmed', "Bob's card to confirm");
    await waitFor(async () => (await card(alice, bob.identity.pubkey))?.status === 'confirmed', "Alice's card to confirm from the receipt");
  }, 30000);

  it('waits when nothing matches, retries per block, and settles once the indexer finds it', async () => {
    const { alice, bob, bobChain, bobWallet, pay } = await setup();
    await pay();
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'waiting', 'the waiting card');
    expect(bobWallet.scan).not.toHaveBeenCalled();

    await bobChain.mine(); // still nothing
    expect((await card(bob, alice.identity.pubkey))?.status).toBe('waiting');
    expect(bobWallet.scan).toHaveBeenCalledWith(TXID);

    bobWallet.scan.mockResolvedValue(HIT(1)); // mined and indexed
    await bobChain.mine();
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'confirmed', 'the card to confirm');
    expect((await card(bob, alice.identity.pubkey))?.amount).toBe(AMOUNT);
    await waitFor(async () => (await card(alice, bob.identity.pubkey))?.status === 'confirmed', "Alice's card to confirm");
  }, 30000);

  it('gives up after a few blocks and leaves the card waiting', async () => {
    const { alice, bob, bobChain, bobWallet, pay } = await setup({ maxWaitingBlocks: 2 });
    await pay();
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'waiting', 'the waiting card');
    await bobChain.mine();
    await bobChain.mine();
    const calls = bobWallet.scan.mock.calls.length;
    expect(calls).toBe(2);
    await bobChain.mine();
    expect(bobWallet.scan.mock.calls.length).toBe(calls);
    expect((await card(bob, alice.identity.pubkey))?.status).toBe('waiting');
  }, 30000);

  it('treats a wallet error as "not found yet" rather than breaking', async () => {
    const { alice, bob, bobWallet, pay } = await setup();
    bobWallet.detect.mockRejectedValue(new Error('hex does not hash to the txid'));
    await pay();
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'waiting', 'the waiting card');
  }, 30000);

  it('picks pending payments back up after a restart', async () => {
    const { alice, bob, bobWallet, bobTracker, pay } = await setup();
    bobWallet.detect.mockResolvedValue(HIT(0));
    await pay();
    await waitFor(async () => (await card(bob, alice.identity.pubkey))?.status === 'pending', 'pending');

    bobTracker.stop();
    await bob.service.stop();
    const again = bob.make();
    running.push(again);
    await again.start();
    await again.settled();
    const chain = new FakeChain();
    const wallet = new FakeWallet();
    const tracker = new PaymentTracker(again, wallet, chain);
    running.push(tracker);
    await tracker.start();

    chain.confirmations = 2;
    await chain.mine();
    await waitFor(async () => {
      const t = await again.getThread(alice.identity.pubkey);
      return (t.find(i => i.kind === 'notice') as any)?.status === 'confirmed';
    }, 'the restored card to confirm');
    await waitFor(async () => (await card(alice, bob.identity.pubkey))?.status === 'confirmed', "Alice's card to confirm");
  }, 40000);

  it('re-checks a notice that was still verifying when the app closed', async () => {
    const { alice, bob, bobTracker, bobWallet, pay } = await setup();
    bobWallet.detect.mockImplementation(() => new Promise<Detect>(() => undefined)); // never answers: "app killed" mid-check
    await pay();
    await waitFor(
      async () => (await card(bob, alice.identity.pubkey))?.status === 'verifying' && bobWallet.detect.mock.calls.length > 0,
      'a notice mid-check',
    );

    bobTracker.stop();
    await bob.service.stop();
    const again = bob.make();
    running.push(again);
    await again.start();
    await again.settled();
    const wallet = new FakeWallet();
    wallet.detect.mockResolvedValue(HIT(0));
    const tracker = new PaymentTracker(again, wallet, new FakeChain());
    running.push(tracker);
    await tracker.start();
    await waitFor(
      async () => ((await again.getThread(alice.identity.pubkey)).find(i => i.kind === 'notice') as any)?.status === 'pending',
      'the card to settle after the restart',
    );
  }, 40000);
});
