import { Transaction } from '../class/wallets/types';

/**
 * Abbreviated address for list rows. Contacts pass a longer lead: silent payment addresses share
 * a long common bech32m prefix, so a 4-character preview makes most of them indistinguishable.
 */
export const shortenAddress = (address: string, lead = 4, tail = 4): string => `${address.slice(0, lead)}...${address.slice(-tail)}`;

export const isIncomingTransaction = (value?: number): boolean => (value ?? 0) >= 0;

/**
 * A self-transfer as the two rows the list shows for it, newest first like the rest of the list:
 * what it paid us, then the send it came from, carrying the fee like any other send. The two add up
 * to the transaction's own value, so the list still sums to the balance. Anything else is one row.
 */
export const splitSelfTransfer = <T extends Transaction>(tx: T): T[] => {
  if (!tx.selfTransfer) return [tx];
  const received = tx.selfTransfer.value;
  return [
    { ...tx, value: received },
    { ...tx, value: (tx.value ?? 0) - received },
  ];
};

/**
 * Returns the most relevant address for display.
 *
 * - **Self-transfer** (either of its rows): the address of ours it paid.
 * - **Outgoing**: the first non-change output address (i.e. not owned by our
 *   wallet).  Falls back to the first output address when every output is ours
 *   (e.g. self-send / consolidation).
 * - **Incoming**: the first output address (typically our receiving address).
 *
 * Pass a `wallet` with `weOwnAddress` to enable change-address filtering.
 */
export const getRelevantAddress = (item: Transaction, wallet?: { weOwnAddress: (address: string) => boolean }): string | null => {
  if (item.selfTransfer?.address) {
    return item.selfTransfer.address;
  }

  if (!item.outputs || item.outputs.length === 0) {
    return null;
  }

  // outgoing transactions — show the recipient, skip change
  if (!isIncomingTransaction(item.value) && wallet) {
    let fallback: string | null = null;
    for (const output of item.outputs) {
      const addr = output.scriptPubKey?.addresses?.[0];
      if (!addr) continue;
      if (fallback === null) fallback = addr; // keep first as fallback
      if (!wallet.weOwnAddress(addr)) {
        return addr; // first non-change address
      }
    }
    // all outputs are ours (self-send) — return first address
    return fallback;
  }

  // incoming transactions, or outgoing without wallet — return first output address
  for (const output of item.outputs) {
    const addr = output.scriptPubKey?.addresses?.[0];
    if (addr) return addr;
  }

  return null;
};
