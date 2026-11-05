import type { Rumor } from 'applesauce-common/helpers/gift-wrap';
import type { ChatService, PendingNotice } from './ChatService';
import type { PaymentNotice } from './events';

/** The slice of the wallet the tracker needs. `HDSilentPaymentsWallet` provides both. */
export interface PaymentWalletPort {
  detectUnconfirmedPayment(params: {
    txid: string;
    tweak: string;
    hex?: string;
  }): Promise<{ found: boolean; totalValue: number; confirmations: number }>;
  scanByTxid(txid: string): Promise<{ found: boolean; totalValue: number; confirmations: number }>;
}

/** The slice of the chain backend the tracker needs. */
export interface ChainPort {
  /** Confirmations the server reports for a transaction, 0 while in the mempool, null when it does not know it. */
  getConfirmations(txid: string): Promise<number | null>;
  /** Calls the listener on each new block. Returns the unsubscribe function. */
  onNewBlock(listener: () => void): () => void;
}

type Tracked =
  | {
      side: 'incoming';
      noticeId: string;
      peer: string;
      notice: PaymentNotice;
      phase: 'waiting' | 'pending';
      amount?: number;
      blocksWaited: number;
    }
  | { side: 'outgoing'; noticeId: string; peer: string; txid: string };

export interface PaymentTrackerOptions {
  /** How many blocks to keep looking for a payment that matched nothing before giving up. */
  maxWaitingBlocks?: number;
  log?: (message: string, error?: unknown) => void;
}

const RECEIPT_ATTEMPTS = 3;
const RECEIPT_RETRY_MS = 1500;

/**
 * Turns payment notices into card states and receipts (§4.5).
 *
 * Receiver: a notice is checked at once with `detectUnconfirmedPayment` (the sender's tweak, the
 * transaction from the notice's hex or Electrum), the card goes Pending and a `detected` receipt goes
 * back. If nothing matches the card says "Waiting" and each new block retries, via the indexer lookup,
 * for a few blocks. Once Electrum reports a confirmation the card goes Confirmed and a `confirmed`
 * receipt is sent. The amount shown is always what our own scan matched, never the message's claim.
 *
 * Sender: follows its own transaction and flips the card to Confirmed on the first confirmation.
 */
export class PaymentTracker {
  private readonly tracked = new Map<string, Tracked>();
  private readonly offs: (() => void)[] = [];
  private busy = false;
  private stopped = true;
  private readonly maxWaitingBlocks: number;

  constructor(
    private readonly service: ChatService,
    private readonly wallet: PaymentWalletPort,
    private readonly chain: ChainPort,
    private readonly options: PaymentTrackerOptions = {},
  ) {
    this.maxWaitingBlocks = options.maxWaitingBlocks ?? 3;
  }

  private log(message: string, error?: unknown): void {
    this.options.log?.(message, error);
  }

  /** Starts listening, and picks up every notice that had not reached Confirmed before a restart. */
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.offs.push(this.service.on('notice', e => void this.onNotice(e.peer, e.noticeId, e.notice, e.rumor)));
    this.offs.push(this.service.on('noticeSent', e => this.trackOutgoing(e.peer, e.noticeId, e.txid)));
    this.offs.push(this.chain.onNewBlock(() => void this.onBlock()));
    try {
      for (const pending of await this.service.listPendingNotices()) await this.resume(pending);
    } catch (e) {
      this.log('could not resume pending payments', e);
    }
  }

  stop(): void {
    this.stopped = true;
    this.offs.splice(0).forEach(off => off());
    this.tracked.clear();
  }

  private trackOutgoing(peer: string, noticeId: string, txid: string): void {
    if (!this.stopped) this.tracked.set(noticeId, { side: 'outgoing', noticeId, peer, txid });
  }

  private async resume(p: PendingNotice): Promise<void> {
    if (this.tracked.has(p.noticeId)) return;
    if (p.mine) return this.trackOutgoing(p.peer, p.noticeId, p.notice.txid);
    if (p.status === 'pending') {
      this.tracked.set(p.noticeId, {
        side: 'incoming',
        noticeId: p.noticeId,
        peer: p.peer,
        notice: p.notice,
        phase: 'pending',
        amount: p.amount,
        blocksWaited: 0,
      });
    } else {
      await this.evaluate(p.peer, p.noticeId, p.notice);
    }
  }

  private async onNotice(peer: string, noticeId: string, notice: PaymentNotice, _rumor: Rumor): Promise<void> {
    if (this.stopped || this.tracked.has(noticeId)) return;
    await this.evaluate(peer, noticeId, notice);
  }

  /** The first look at an incoming notice. */
  private async evaluate(peer: string, noticeId: string, notice: PaymentNotice): Promise<void> {
    await this.service.setCardState(noticeId, 'verifying');
    let found = false;
    let total = 0;
    let confirmations = 0;
    try {
      const r = await this.wallet.detectUnconfirmedPayment({ txid: notice.txid, tweak: notice.tweak, hex: notice.hex });
      ({ found, totalValue: total, confirmations } = r);
    } catch (e) {
      this.log('payment notice could not be checked', e);
    }
    if (this.stopped) return;
    if (found) await this.onFound(peer, noticeId, notice, total, confirmations);
    else {
      await this.service.setCardState(noticeId, 'waiting');
      this.tracked.set(noticeId, { side: 'incoming', noticeId, peer, notice, phase: 'waiting', blocksWaited: 0 });
    }
  }

  private async onFound(peer: string, noticeId: string, notice: PaymentNotice, total: number, confirmations: number): Promise<void> {
    if (confirmations > 0) {
      await this.service.setCardState(noticeId, 'confirmed', total);
      this.tracked.delete(noticeId);
      await this.receipt(peer, noticeId, 'detected', notice.txid, total);
      await this.receipt(peer, noticeId, 'confirmed', notice.txid, total);
      return;
    }
    await this.service.setCardState(noticeId, 'pending', total);
    this.tracked.set(noticeId, { side: 'incoming', noticeId, peer, notice, phase: 'pending', amount: total, blocksWaited: 0 });
    await this.receipt(peer, noticeId, 'detected', notice.txid, total);
  }

  private async receipt(peer: string, noticeId: string, status: 'detected' | 'confirmed', txid: string, amount: number): Promise<void> {
    for (let attempt = 1; attempt <= RECEIPT_ATTEMPTS; attempt++) {
      try {
        await this.service.sendReceipt(peer, noticeId, status, txid, amount);
        return;
      } catch (e) {
        this.log(`receipt (${status}) attempt ${attempt} failed`, e);
        if (attempt < RECEIPT_ATTEMPTS) await new Promise<void>(resolve => setTimeout(resolve, RECEIPT_RETRY_MS));
      }
    }
  }

  /** One pass over everything being followed. Passes do not overlap: a slow block never stacks them. */
  private async onBlock(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      for (const t of [...this.tracked.values()]) {
        if (this.stopped) return;
        try {
          await this.step(t);
        } catch (e) {
          this.log('payment tracking step failed', e);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async step(t: Tracked): Promise<void> {
    if (t.side === 'outgoing') {
      const confs = await this.chain.getConfirmations(t.txid);
      if ((confs ?? 0) >= 1) {
        await this.service.setCardState(t.noticeId, 'confirmed');
        this.tracked.delete(t.noticeId);
      }
      return;
    }

    if (t.phase === 'waiting') {
      t.blocksWaited++;
      // Maybe the transaction reached the mempool since; failing that, a block may have mined it.
      let r = await this.wallet
        .detectUnconfirmedPayment({ txid: t.notice.txid, tweak: t.notice.tweak, hex: t.notice.hex })
        .catch(() => undefined);
      if (!r?.found) r = await this.wallet.scanByTxid(t.notice.txid).catch(() => undefined);
      if (r?.found) {
        // The indexer only knows mined transactions, so its answer always carries a confirmation.
        await this.onFound(t.peer, t.noticeId, t.notice, r.totalValue, r.confirmations);
      } else if (t.blocksWaited >= this.maxWaitingBlocks) {
        this.tracked.delete(t.noticeId);
      }
      return;
    }

    const confs = await this.chain.getConfirmations(t.notice.txid);
    if ((confs ?? 0) < 1) return;
    const amount = t.amount ?? 0;
    await this.service.setCardState(t.noticeId, 'confirmed', amount);
    this.tracked.delete(t.noticeId);
    // Pull the confirmed height in now rather than at the next poll, so the balance settles with the card.
    this.wallet.scanByTxid(t.notice.txid).catch(() => undefined);
    await this.receipt(t.peer, t.noticeId, 'confirmed', t.notice.txid, amount);
  }
}
