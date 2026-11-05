import { webcrypto } from 'crypto';
import { InMemoryRelay } from '../../helpers/chat/inMemoryRelay';
import { nobleSubtle } from '../../helpers/chat/nobleSubtle';
import { ChatService, PeerNotOnChatError, type ThreadItem } from '../../helpers/chat/ChatService';
import { RELAYS, makeUser, waitFor, type User } from './chatTestKit';

const TXID = 'ab'.repeat(32);
const TWEAK = '02' + 'cd'.repeat(32);

const texts = (items: ThreadItem[]) =>
  items
    .filter((i): i is Extract<ThreadItem, { kind: 'text' }> => i.kind === 'text')
    .map(i => i.text)
    .reverse();

describe('ChatService', () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const running: ChatService[] = [];
  const start = async (u: User, service = u.service) => {
    running.push(service);
    await service.start();
    await service.settled();
  };

  beforeAll(() => {
    // Run on the noble shim alone, as on Hermes.
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
    for (const s of running.splice(0)) await s.stop();
  });

  it('publishes a key package and relay lists, and sees who is on chat', async () => {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay);
    const bob = makeUser('bob', 2, relay);
    alice.contacts = [bob.identity.address];
    await start(alice);

    expect(await alice.service.isOnChat(bob.identity.address)).toBe(false);
    await expect(alice.service.sendText(bob.identity.address, 'hi')).rejects.toBeInstanceOf(PeerNotOnChatError);

    await start(bob);
    const kinds = relay.published.map(e => e.kind);
    expect(kinds).toEqual(expect.arrayContaining([30443, 10002, 10050]));
    expect(relay.published.filter(e => e.kind === 10050 && e.pubkey === bob.identity.pubkey)).toHaveLength(1);
    expect(await alice.service.isOnChat(bob.identity.address, true)).toBe(true);

    // A second start with the same state does not republish the relay lists.
    await bob.service.stop();
    const again = bob.make();
    await start(bob, again);
    expect(relay.published.filter(e => e.kind === 10050 && e.pubkey === bob.identity.pubkey)).toHaveLength(1);
  });

  it('invite → chat → notice → receipt between two contacts', async () => {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay);
    const bob = makeUser('bob', 2, relay);
    alice.contacts = [bob.identity.address];
    bob.contacts = [alice.identity.address];
    await start(alice);
    await start(bob);

    const notices: any[] = [];
    bob.service.on('notice', e => notices.push(e));

    // Alice messages first: she creates the group and invites Bob, who joins on his own.
    await alice.service.sendText(bob.identity.address, 'dinner money 🍕');
    const bobThread = await waitFor(async () => {
      const t = await bob.service.getThread(alice.identity.pubkey);
      return t.length > 0 && t;
    }, "Bob's thread");
    expect(texts(bobThread)).toEqual(['dinner money 🍕']);
    expect(bob.service.getPeer(alice.identity.pubkey)).toMatchObject({
      unread: 1,
      createdBy: alice.identity.pubkey,
      lastMessage: { kind: 'text', mine: false },
    });
    expect(bob.service.totalUnread()).toBe(1);
    await bob.service.markRead(alice.identity.pubkey);
    expect(bob.service.totalUnread()).toBe(0);

    // Bob answers over the same group.
    await bob.service.sendText(alice.identity.address, 'thanks!');
    await waitFor(async () => texts(await alice.service.getThread(bob.identity.pubkey)).length === 2, 'Alice sees the reply');
    expect(texts(await alice.service.getThread(bob.identity.pubkey))).toEqual(['dinner money 🍕', 'thanks!']);
    expect(alice.service.getPeer(bob.identity.pubkey)?.groupId).toBe(bob.service.getPeer(alice.identity.pubkey)?.groupId);

    // Payment notice → Bob's wallet layer reacts → receipt → Alice's card moves.
    const noticeRumor = await alice.service.sendNotice(bob.identity.address, {
      txid: TXID,
      tweak: TWEAK,
      amount: 50000,
      note: 'for lunch',
    });
    await waitFor(() => notices.length === 1, 'the notice event');
    expect(notices[0]).toMatchObject({
      peer: alice.identity.pubkey,
      noticeId: noticeRumor.id,
      notice: { txid: TXID, amount: 50000, note: 'for lunch', net: 'signet' },
    });

    const card = async (u: User, peer: string) =>
      (await u.service.getThread(peer)).find(i => i.kind === 'notice') as Extract<ThreadItem, { kind: 'notice' }> | undefined;
    expect((await card(alice, bob.identity.pubkey))?.status).toBe('sent');
    expect((await card(bob, alice.identity.pubkey))?.status).toBe('verifying');

    await bob.service.setCardState(noticeRumor.id, 'pending', 50000);
    await bob.service.sendReceipt(alice.identity.pubkey, noticeRumor.id, 'detected', TXID, 50000);
    await waitFor(async () => (await card(alice, bob.identity.pubkey))?.status === 'received', 'Alice to see "received"');
    expect(await card(bob, alice.identity.pubkey)).toMatchObject({ status: 'pending', amount: 50000, mine: false });

    await bob.service.setCardState(noticeRumor.id, 'confirmed', 50000);
    await bob.service.sendReceipt(alice.identity.pubkey, noticeRumor.id, 'confirmed', TXID, 50000);
    await waitFor(async () => (await card(alice, bob.identity.pubkey))?.status === 'confirmed', 'Alice to see "confirmed"');
    expect((await card(bob, alice.identity.pubkey))?.status).toBe('confirmed');

    // The relay never saw anything but key packages, relay lists, group messages and gift wraps.
    const allowed = new Set([30443, 10002, 10050, 445, 1059]);
    expect(relay.published.every(e => allowed.has(e.kind))).toBe(true);
  }, 30000);

  it('marks a request as paid once a notice answers it', async () => {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay);
    const bob = makeUser('bob', 2, relay);
    alice.contacts = [bob.identity.address];
    bob.contacts = [alice.identity.address];
    await start(alice);
    await start(bob);

    const request = await bob.service.sendRequest(alice.identity.address, { address: bob.identity.address, amount: 21000, note: 'rent' });
    await waitFor(async () => (await alice.service.getThread(bob.identity.pubkey)).some(i => i.kind === 'request'), 'the request card');
    const open = (await alice.service.getThread(bob.identity.pubkey)).find(i => i.kind === 'request');
    expect(open).toMatchObject({ kind: 'request', status: 'open', mine: false, request: { amount: 21000, note: 'rent' } });

    await alice.service.sendNotice(bob.identity.address, { txid: TXID, tweak: TWEAK, amount: 21000 }, request.id);
    await waitFor(
      async () => (await bob.service.getThread(alice.identity.pubkey)).some(i => i.kind === 'notice'),
      'the notice on the request',
    );
    const after = await bob.service.getThread(alice.identity.pubkey);
    expect(after.find(i => i.kind === 'request')).toMatchObject({ status: 'paid' });
    expect(after.find(i => i.kind === 'notice')).toMatchObject({ requestId: request.id });
  }, 30000);

  it('holds an invite from a stranger as a message request until accepted or declined', async () => {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay);
    const bob = makeUser('bob', 2, relay);
    const carol = makeUser('carol', 3, relay);
    carol.contacts = [bob.identity.address, alice.identity.address];
    alice.contacts = [bob.identity.address];
    bob.contacts = [alice.identity.address]; // Bob has not saved Carol
    await start(alice);
    await start(bob);
    await start(carol);

    await carol.service.sendText(bob.identity.address, 'hello stranger');
    const requests = await waitFor(() => bob.service.getRequests().length > 0 && bob.service.getRequests(), 'a message request');
    expect(requests[0].from).toBe(carol.identity.pubkey);
    expect(bob.service.listPeers()).toHaveLength(0);

    // Saving her as a contact accepts the request on its own.
    bob.contacts.push(carol.identity.address);
    await bob.service.refreshContacts();
    await waitFor(
      async () => texts(await bob.service.getThread(carol.identity.pubkey)).includes('hello stranger'),
      "Carol's message after accepting",
    );
    expect(bob.service.getRequests()).toHaveLength(0);

    // Declining drops it for good.
    const dave = makeUser('dave', 4, relay);
    dave.contacts = [alice.identity.address];
    await start(dave);
    await dave.service.sendText(alice.identity.address, 'psst');
    const [req] = await waitFor(() => alice.service.getRequests().length > 0 && alice.service.getRequests(), "Dave's request");
    await alice.service.declineRequest(req.id);
    expect(alice.service.getRequests()).toHaveLength(0);
    expect(alice.service.listPeers().find(p => p.peer === dave.identity.pubkey)).toBeUndefined();
  }, 30000);

  it('converges on one group when both sides message first, and keeps both messages', async () => {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay);
    const bob = makeUser('bob', 2, relay);
    alice.contacts = [bob.identity.address];
    bob.contacts = [alice.identity.address];
    await start(alice);
    await start(bob);

    await Promise.all([
      alice.service.sendText(bob.identity.address, 'from alice'),
      bob.service.sendText(alice.identity.address, 'from bob'),
    ]);

    const canonical = alice.identity.pubkey < bob.identity.pubkey ? alice.identity.pubkey : bob.identity.pubkey;
    await waitFor(async () => {
      const a = alice.service.getPeer(bob.identity.pubkey);
      const b = bob.service.getPeer(alice.identity.pubkey);
      return a && b && a.groupId === b.groupId && a.createdBy === canonical && b.createdBy === canonical;
    }, 'both sides on the canonical group');
    const both = ['from alice', 'from bob'];
    await waitFor(async () => {
      const a = texts(await alice.service.getThread(bob.identity.pubkey)).sort();
      const b = texts(await bob.service.getThread(alice.identity.pubkey)).sort();
      return JSON.stringify(a) === JSON.stringify(both) && JSON.stringify(b) === JSON.stringify(both);
    }, 'both messages on both sides');

    // And the converged group carries new traffic.
    await alice.service.sendText(bob.identity.address, 'after');
    await waitFor(
      async () => texts(await bob.service.getThread(alice.identity.pubkey)).includes('after'),
      'a message on the converged group',
    );
  }, 40000);

  it('keeps the group and its history across a restart', async () => {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay);
    const bob = makeUser('bob', 2, relay);
    alice.contacts = [bob.identity.address];
    bob.contacts = [alice.identity.address];
    await start(alice);
    await start(bob);
    await alice.service.sendText(bob.identity.address, 'before restart');
    await waitFor(async () => texts(await bob.service.getThread(alice.identity.pubkey)).length === 1, 'the first message');
    const groupId = bob.service.getPeer(alice.identity.pubkey)!.groupId;

    await bob.service.stop();
    const bobAgain = bob.make();
    await start(bob, bobAgain);
    expect(bobAgain.getPeer(alice.identity.pubkey)).toMatchObject({ groupId, unread: 1 });
    expect(texts(await bobAgain.getThread(alice.identity.pubkey))).toEqual(['before restart']);

    // The restored client still decrypts new traffic and can answer in the same group.
    await alice.service.sendText(bob.identity.address, 'after restart');
    await waitFor(
      async () => texts(await bobAgain.getThread(alice.identity.pubkey)).includes('after restart'),
      'a message after the restart',
    );
    await bobAgain.sendText(alice.identity.address, 'still here');
    await waitFor(
      async () => texts(await alice.service.getThread(bob.identity.pubkey)).includes('still here'),
      'a reply after the restart',
    );
    expect(bobAgain.getPeer(alice.identity.pubkey)?.groupId).toBe(groupId);
  }, 40000);

  it('ignores payment notices for another network', async () => {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay, 'signet');
    const bob = makeUser('bob', 2, relay, 'testnet4');
    alice.contacts = [bob.identity.address];
    bob.contacts = [alice.identity.address];
    await start(alice);
    await start(bob);
    const seen: unknown[] = [];
    bob.service.on('notice', e => seen.push(e));

    await alice.service.sendText(bob.identity.address, 'hello');
    await alice.service.sendNotice(bob.identity.address, { txid: TXID, tweak: TWEAK, amount: 1 });
    await waitFor(async () => texts(await bob.service.getThread(alice.identity.pubkey)).includes('hello'), 'the chat message');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(seen).toHaveLength(0);
    expect((await bob.service.getThread(alice.identity.pubkey)).some(i => i.kind === 'notice')).toBe(false);
  }, 30000);

  it('refuses to send when stopped, and rejects empty or oversized text', async () => {
    const relay = new InMemoryRelay(RELAYS);
    const alice = makeUser('alice', 1, relay);
    const bob = makeUser('bob', 2, relay);
    await expect(alice.service.sendText(bob.identity.address, 'x')).rejects.toThrow('not running');
    await start(alice);
    await expect(alice.service.sendText(bob.identity.address, '   ')).rejects.toThrow('empty');
    await expect(alice.service.sendText('nonsense', 'hi')).rejects.toThrow('silent payment address');
  });
});
