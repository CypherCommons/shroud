import type { Rumor } from 'applesauce-common/helpers/gift-wrap';
import { getEventHash } from 'applesauce-core/helpers/event';
import {
  MAX_NOTE_LENGTH,
  MAX_TX_HEX_LENGTH,
  buildChatRumor,
  buildNoticeRumor,
  buildReceiptRumor,
  buildRequestRumor,
  formatSats,
  parseRumor,
  parsePaymentNotice,
} from '../../helpers/chat/events';
import { KIND_CHAT, KIND_PAYMENT_NOTICE, KIND_PAYMENT_RECEIPT, KIND_PAYMENT_REQUEST } from '../../helpers/chat/kinds';

const PK = 'a'.repeat(64);
const TXID = 'b'.repeat(64);
const TWEAK = '02' + 'c'.repeat(64);
const EVENT_ID = 'd'.repeat(64);

const rumor = (kind: number, content: string, tags: string[][] = []): Rumor =>
  ({ id: 'x', pubkey: PK, created_at: 1, kind, tags, content }) as Rumor;
const notice = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, net: 'signet', txid: TXID, tweak: TWEAK, amount: 50000, ...over });

describe('chat events: builders', () => {
  it('hashes the rumor id and tags notices, receipts and requests with alt text', () => {
    const n = buildNoticeRumor(PK, { net: 'signet', txid: TXID, tweak: TWEAK, amount: 50000, note: 'lunch' });
    expect(n.kind).toBe(KIND_PAYMENT_NOTICE);
    expect(n.id).toBe(getEventHash({ ...n, id: '' } as any));
    expect(n.tags).toContainEqual(['alt', 'Sent you 50,000 sats']);
    expect(n.tags.some(t => t[0] === 'e')).toBe(false);

    const paying = buildNoticeRumor(PK, { net: 'signet', txid: TXID, tweak: TWEAK, amount: 1 }, EVENT_ID);
    expect(paying.tags).toContainEqual(['e', EVENT_ID]);
    expect(JSON.parse(paying.content).req).toBe(EVENT_ID);

    const r = buildReceiptRumor(PK, { txid: TXID, status: 'detected', amount: 50000 }, n.id);
    expect(r.kind).toBe(KIND_PAYMENT_RECEIPT);
    expect(r.tags).toContainEqual(['e', n.id]);
    expect(r.tags.some(t => t[0] === 'alt')).toBe(true);

    const q = buildRequestRumor(PK, { net: 'signet', address: 'tsp1abc', amount: 123456 });
    expect(q.kind).toBe(KIND_PAYMENT_REQUEST);
    expect(q.tags).toContainEqual(['alt', 'Requested 123,456 sats']);
    expect(buildChatRumor(PK, 'hi').kind).toBe(KIND_CHAT);
  });

  it('round-trips through the parser', () => {
    const n = buildNoticeRumor(PK, { net: 'signet', txid: TXID, tweak: TWEAK, amount: 50000, note: 'x', hex: '00ff' });
    expect(parseRumor(n)).toMatchObject({ type: 'notice', notice: { txid: TXID, amount: 50000, hex: '00ff', note: 'x' } });
    const r = buildReceiptRumor(PK, { txid: TXID, status: 'confirmed', amount: 7 }, n.id);
    expect(parseRumor(r)).toMatchObject({ type: 'receipt', noticeId: n.id, receipt: { status: 'confirmed', amount: 7 } });
    const q = buildRequestRumor(PK, { net: 'signet', address: 'tsp1abc', amount: 9, note: 'rent', exp: 2000000000 });
    expect(parseRumor(q)).toMatchObject({ type: 'request', request: { amount: 9, note: 'rent', exp: 2000000000 } });
    expect(parseRumor(buildChatRumor(PK, 'hello'))).toMatchObject({ type: 'text', text: 'hello' });
  });

  it('formats sats with thousands separators', () => {
    expect([0, 999, 1000, 50000, 123456789, 2100000000000000].map(formatSats)).toEqual([
      '0',
      '999',
      '1,000',
      '50,000',
      '123,456,789',
      '2,100,000,000,000,000',
    ]);
  });
});

describe('chat events: validation', () => {
  it('accepts a minimal valid notice and strips unknown fields', () => {
    expect(parsePaymentNotice(notice({ extra: 'ignored' }))).toEqual({ v: 1, net: 'signet', txid: TXID, tweak: TWEAK, amount: 50000 });
  });

  it.each([
    ['not JSON', 'nope'],
    ['JSON array', '[]'],
    ['wrong version', notice({ v: 2 })],
    ['missing net', notice({ net: undefined })],
    ['net too long', notice({ net: 'x'.repeat(33) })],
    ['short txid', notice({ txid: 'ab' })],
    ['uppercase txid', notice({ txid: 'B'.repeat(64) })],
    ['non-hex txid', notice({ txid: 'z'.repeat(64) })],
    ['tweak wrong length', notice({ tweak: '02' + 'c'.repeat(62) })],
    ['tweak x-only (no prefix)', notice({ tweak: 'c'.repeat(66) })],
    ['tweak 04 prefix', notice({ tweak: '04' + 'c'.repeat(64) })],
    ['zero amount', notice({ amount: 0 })],
    ['negative amount', notice({ amount: -5 })],
    ['fractional amount', notice({ amount: 1.5 })],
    ['string amount', notice({ amount: '5' })],
    ['amount above 21M BTC', notice({ amount: 21_000_000 * 100_000_000 + 1 })],
    ['odd-length hex', notice({ hex: 'abc' })],
    ['empty hex', notice({ hex: '' })],
    ['oversized hex', notice({ hex: 'ab'.repeat(MAX_TX_HEX_LENGTH / 2 + 1) })],
    ['oversized note', notice({ note: 'n'.repeat(MAX_NOTE_LENGTH + 1) })],
    ['non-string note', notice({ note: 5 })],
    ['bad req id', notice({ req: 'short' })],
  ])('rejects a notice with %s', (_label, content) => {
    expect(parsePaymentNotice(content as string)).toBeNull();
  });

  it('rejects a notice whose e tag and req disagree, or whose e tag is not an event id', () => {
    expect(parseRumor(rumor(KIND_PAYMENT_NOTICE, notice({ req: EVENT_ID }), [['e', 'f'.repeat(64)]]))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_NOTICE, notice(), [['e', 'nope']]))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_NOTICE, notice(), [['e', EVENT_ID]]))).toMatchObject({ type: 'notice', requestId: EVENT_ID });
  });

  it('requires a receipt to reference a notice and carry a known status', () => {
    const body = (over: Record<string, unknown> = {}) => JSON.stringify({ v: 1, txid: TXID, status: 'detected', amount: 5, ...over });
    expect(parseRumor(rumor(KIND_PAYMENT_RECEIPT, body()))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_RECEIPT, body(), [['e', 'bad']]))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_RECEIPT, body({ status: 'paid' }), [['e', EVENT_ID]]))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_RECEIPT, body({ txid: 'x' }), [['e', EVENT_ID]]))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_RECEIPT, body(), [['e', EVENT_ID]]))).not.toBeNull();
  });

  it('validates requests', () => {
    const body = (over: Record<string, unknown> = {}) => JSON.stringify({ v: 1, net: 'signet', address: 'tsp1abc', amount: 5, ...over });
    expect(parseRumor(rumor(KIND_PAYMENT_REQUEST, body()))).not.toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_REQUEST, body({ amount: 0 })))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_REQUEST, body({ address: '' })))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_REQUEST, body({ exp: -1 })))).toBeNull();
    expect(parseRumor(rumor(KIND_PAYMENT_REQUEST, body({ exp: 1.5 })))).toBeNull();
  });

  it('ignores unknown kinds, empty text, and malformed rumors instead of throwing', () => {
    expect(parseRumor(rumor(1, 'a note'))).toBeNull();
    expect(parseRumor(rumor(KIND_CHAT, ''))).toBeNull();
    expect(parseRumor(rumor(KIND_CHAT, 'x'.repeat(10_001)))).toBeNull();
    expect(parseRumor({ kind: KIND_CHAT } as any)).toBeNull();
    expect(parseRumor(null as any)).toBeNull();
  });
});
