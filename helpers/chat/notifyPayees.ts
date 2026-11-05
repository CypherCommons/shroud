import type { Network } from 'bitcoinjs-lib';
import type { ChatService } from './ChatService';
import { isSilentPaymentAddress } from '../silent-payments';

export interface Payee {
  /** The address as the user entered or picked it: the silent payment address, not the one-time output. */
  address: string;
  /** Sats, or undefined for a send-max output. */
  value?: number;
}

export interface NotifyArgs {
  service: ChatService;
  txid: string;
  /** The signed transaction, sent so the payee can verify it by hashing and rebroadcast it. */
  hex: string;
  /** BIP-352 scan tweak from `wallet.computeScanTweak`, taken before broadcast. */
  tweak: string;
  payees: Payee[];
  /** What the transaction paid in total to non-change outputs: stands in for a send-max payee's amount. */
  fallbackAmount?: number;
  note?: string;
  network: Network;
  log?: (message: string, error?: unknown) => void;
}

/**
 * After a broadcast: tells each payee who is on Shroud chat about the payment. Never throws and never
 * waits on a payee who is not on chat, since Track Payment still covers them. Returns the addresses notified.
 */
export async function notifyPayees(args: NotifyArgs): Promise<string[]> {
  const { service, txid, hex, tweak, payees, note, network } = args;
  const notified: string[] = [];
  const sp = payees.filter(p => isSilentPaymentAddress(p.address, network));

  await Promise.all(
    sp.map(async payee => {
      try {
        const amount = payee.value ?? (sp.length === 1 ? args.fallbackAmount : undefined);
        if (!amount || amount <= 0) return;
        if (!(await service.isOnChat(payee.address))) return;
        await service.sendNotice(payee.address, { txid, tweak, hex, amount, note: note?.trim() ? note.trim() : undefined });
        notified.push(payee.address);
      } catch (e) {
        args.log?.(`could not notify ${payee.address.slice(0, 12)}…`, e);
      }
    }),
  );
  return notified;
}
