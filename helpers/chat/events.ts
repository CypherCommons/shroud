import type { Rumor } from 'applesauce-common/helpers/gift-wrap';
import { getEventHash } from 'applesauce-core/helpers/event';
import { KIND_CHAT, KIND_PAYMENT_NOTICE, KIND_PAYMENT_RECEIPT, KIND_PAYMENT_REQUEST } from './kinds';

/**
 * Shroud's app events: unsigned Nostr-shaped rumors carried inside MLS application messages.
 *
 * Marmot lets an app use any inner kind and tells clients to ignore kinds they don't know, so
 * other Marmot apps simply skip ours (every custom event carries an `alt` tag for them). marmot-ts
 * already enforces that `rumor.pubkey` is the authenticated MLS sender; everything *inside* the
 * content is attacker-controlled and is validated here before any code acts on it.
 */

export const EVENT_VERSION = 1;

/** Upper bound for a transaction `hex` in a notice: Bitcoin Core's standard-tx cap is 400 kvB. */
export const MAX_TX_HEX_LENGTH = 2 * 400_000;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_TEXT_LENGTH = 10_000;
const MAX_SATS = 21_000_000 * 100_000_000;

export type ReceiptStatus = 'detected' | 'confirmed';

export interface PaymentNotice {
  v: 1;
  /** Network id (`bitcoin`, `signet`, …). Events for another network are ignored. */
  net: string;
  txid: string;
  /** 33-byte compressed point, 66 hex chars: the BIP-352 scan tweak the receiver scans with. */
  tweak: string;
  /** Raw transaction hex. The receiver verifies it by hashing; optional. */
  hex?: string;
  /** Sats, display-only. The UI shows the amount the receiver's own scan matched. */
  amount: number;
  note?: string;
  /** Id of the payment request this pays, mirrored from the `e` tag. */
  req?: string;
}

export interface PaymentReceipt {
  v: 1;
  txid: string;
  status: ReceiptStatus;
  amount: number;
}

export interface PaymentRequest {
  v: 1;
  net: string;
  address: string;
  amount: number;
  note?: string;
  /** Unix seconds after which the request should no longer be offered for payment. */
  exp?: number;
}

export type ParsedChatEvent =
  | { type: 'text'; rumor: Rumor; text: string }
  | { type: 'notice'; rumor: Rumor; notice: PaymentNotice; requestId?: string }
  | { type: 'receipt'; rumor: Rumor; receipt: PaymentReceipt; noticeId: string }
  | { type: 'request'; rumor: Rumor; request: PaymentRequest };

const HEX = /^[0-9a-f]*$/;
const isHex = (s: unknown, len?: number): s is string =>
  typeof s === 'string' && HEX.test(s) && (len === undefined ? s.length % 2 === 0 : s.length === len);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSats = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_SATS;
const isNonEmptyString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

const parseJson = (content: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(content);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
};

const tagValue = (rumor: Rumor, name: string): string | undefined => rumor.tags.find(t => t[0] === name && typeof t[1] === 'string')?.[1];

/** A compressed secp256k1 point: 33 bytes, `02`/`03` prefix. Curve membership is checked by the scanner. */
export const isCompressedPointHex = (s: unknown): s is string => isHex(s, 66) && (s.startsWith('02') || s.startsWith('03'));

export function parsePaymentNotice(content: string): PaymentNotice | null {
  const o = parseJson(content);
  if (!o || o.v !== EVENT_VERSION) return null;
  if (!isNonEmptyString(o.net, 32) || !isHex(o.txid, 64) || !isCompressedPointHex(o.tweak) || !isSats(o.amount)) return null;
  if (o.hex !== undefined && !(isHex(o.hex) && o.hex.length > 0 && o.hex.length <= MAX_TX_HEX_LENGTH)) return null;
  if (o.note !== undefined && !(typeof o.note === 'string' && o.note.length <= MAX_NOTE_LENGTH)) return null;
  if (o.req !== undefined && !isHex(o.req, 64)) return null;
  const notice: PaymentNotice = { v: 1, net: o.net, txid: o.txid, tweak: o.tweak, amount: o.amount };
  if (o.hex !== undefined) notice.hex = o.hex as string;
  if (o.note !== undefined) notice.note = o.note as string;
  if (o.req !== undefined) notice.req = o.req as string;
  return notice;
}

export function parsePaymentReceipt(content: string): PaymentReceipt | null {
  const o = parseJson(content);
  if (!o || o.v !== EVENT_VERSION) return null;
  if (!isHex(o.txid, 64) || (o.status !== 'detected' && o.status !== 'confirmed') || !isSats(o.amount)) return null;
  return { v: 1, txid: o.txid, status: o.status, amount: o.amount };
}

export function parsePaymentRequest(content: string): PaymentRequest | null {
  const o = parseJson(content);
  if (!o || o.v !== EVENT_VERSION) return null;
  if (!isNonEmptyString(o.net, 32) || !isNonEmptyString(o.address, 300) || !isSats(o.amount)) return null;
  if (o.note !== undefined && !(typeof o.note === 'string' && o.note.length <= MAX_NOTE_LENGTH)) return null;
  if (o.exp !== undefined && !(typeof o.exp === 'number' && Number.isSafeInteger(o.exp) && o.exp > 0)) return null;
  const request: PaymentRequest = { v: 1, net: o.net, address: o.address, amount: o.amount };
  if (o.note !== undefined) request.note = o.note as string;
  if (o.exp !== undefined) request.exp = o.exp as number;
  return request;
}

/**
 * Validates and classifies a received rumor. Returns null for anything that isn't a well-formed
 * Shroud event (other apps' kinds, malformed content, a receipt with no `e` tag): callers ignore
 * those rather than raise, since a peer can send arbitrary bytes.
 */
export function parseRumor(rumor: Rumor): ParsedChatEvent | null {
  if (!rumor || typeof rumor.content !== 'string' || !Array.isArray(rumor.tags)) return null;
  switch (rumor.kind) {
    case KIND_CHAT:
      return rumor.content.length > 0 && rumor.content.length <= MAX_TEXT_LENGTH ? { type: 'text', rumor, text: rumor.content } : null;
    case KIND_PAYMENT_NOTICE: {
      const notice = parsePaymentNotice(rumor.content);
      if (!notice) return null;
      const requestId = tagValue(rumor, 'e');
      // The `e` tag and the content's `req` must agree; a mismatch is a malformed event.
      if (requestId !== undefined && !isHex(requestId, 64)) return null;
      if (notice.req !== undefined && requestId !== undefined && notice.req !== requestId) return null;
      return { type: 'notice', rumor, notice, requestId: requestId ?? notice.req };
    }
    case KIND_PAYMENT_RECEIPT: {
      const receipt = parsePaymentReceipt(rumor.content);
      const noticeId = tagValue(rumor, 'e');
      if (!receipt || !noticeId || !isHex(noticeId, 64)) return null;
      return { type: 'receipt', rumor, receipt, noticeId };
    }
    case KIND_PAYMENT_REQUEST: {
      const request = parsePaymentRequest(rumor.content);
      return request ? { type: 'request', rumor, request } : null;
    }
    default:
      return null;
  }
}

/** `50000` → `50,000`, without relying on Intl being present on the JS engine. */
export const formatSats = (sats: number): string => String(Math.trunc(sats)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const buildRumor = (pubkey: string, kind: number, content: string, tags: string[][], now: number): Rumor => {
  const rumor = { id: '', pubkey, created_at: now, kind, tags, content };
  rumor.id = getEventHash(rumor);
  return rumor as Rumor;
};

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export function buildChatRumor(pubkey: string, text: string, now: number = nowSeconds()): Rumor {
  return buildRumor(pubkey, KIND_CHAT, text, [], now);
}

export function buildNoticeRumor(pubkey: string, notice: Omit<PaymentNotice, 'v'>, requestId?: string, now: number = nowSeconds()): Rumor {
  const payload: PaymentNotice = { v: 1, ...notice, ...(requestId ? { req: requestId } : {}) };
  const tags: string[][] = [['alt', `Sent you ${formatSats(notice.amount)} sats`]];
  if (requestId) tags.push(['e', requestId]);
  return buildRumor(pubkey, KIND_PAYMENT_NOTICE, JSON.stringify(payload), tags, now);
}

export function buildReceiptRumor(pubkey: string, receipt: Omit<PaymentReceipt, 'v'>, noticeId: string, now: number = nowSeconds()): Rumor {
  const alt =
    receipt.status === 'confirmed'
      ? `Payment of ${formatSats(receipt.amount)} sats confirmed`
      : `Received ${formatSats(receipt.amount)} sats`;
  return buildRumor(
    pubkey,
    KIND_PAYMENT_RECEIPT,
    JSON.stringify({ v: 1, ...receipt }),
    [
      ['e', noticeId],
      ['alt', alt],
    ],
    now,
  );
}

export function buildRequestRumor(pubkey: string, request: Omit<PaymentRequest, 'v'>, now: number = nowSeconds()): Rumor {
  return buildRumor(
    pubkey,
    KIND_PAYMENT_REQUEST,
    JSON.stringify({ v: 1, ...request }),
    [['alt', `Requested ${formatSats(request.amount)} sats`]],
    now,
  );
}
