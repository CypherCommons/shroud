import type { Network } from 'bitcoinjs-lib';
import { pubkeyFromAddress } from './identity';

/**
 * Whether a payment request's address is the sender's own. A chat identity is derived from a silent
 * payment address, so the check is `pubkeyFromAddress(address) === sender`: without it, a request in
 * a conversation with Bob could ask to be paid at Mallory's address and show as coming from Bob.
 * An address that does not parse on this network counts as not belonging.
 */
export function requestBelongsToSender(address: string, senderPubkey: string, network: Network): boolean {
  try {
    return pubkeyFromAddress(address, network) === senderPubkey;
  } catch {
    return false;
  }
}
