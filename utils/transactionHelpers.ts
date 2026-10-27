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
 * - **Outgoing**: the first output address that isn't ours, so not our change.
 *   Falls back to the first output address when every output is ours
 *   (e.g. self-send / consolidation).
 * - **Incoming**: the first output address that is ours, so not the sender's
 *   change. Falls back to the first output address when none is recognisably
 *   ours (e.g. a silent payment row, whose outputs carry our sp1 address).
 *
 * Without a `wallet` to tell our outputs apart, the first output address.
 */
export const getRelevantAddress = (item: Transaction, wallet?: { weOwnAddress: (address: string) => boolean }): string | null => {
  if (item.selfTransfer?.address) {
    return item.selfTransfer.address;
  }

  const addresses = (item.outputs ?? [])
    .map(output => output.scriptPubKey?.addresses?.[0])
    .filter((address): address is string => !!address);
  if (addresses.length === 0) return null;
  if (!wallet) return addresses[0];

  const incoming = isIncomingTransaction(item.value);
  return addresses.find(address => wallet.weOwnAddress(address) === incoming) ?? addresses[0];
};
