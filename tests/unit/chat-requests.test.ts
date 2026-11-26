import { deriveChatIdentity } from '../../helpers/chat/identity';
import { requestBelongsToSender } from '../../helpers/chat/requests';
import { getNetwork } from '../../modules/network';

const SIGNET = getNetwork('signet');
const bob = deriveChatIdentity(Buffer.alloc(64, 2), SIGNET);
const mallory = deriveChatIdentity(Buffer.alloc(64, 9), SIGNET);

describe('requestBelongsToSender', () => {
  it("accepts the sender's own address, in any case", () => {
    expect(requestBelongsToSender(bob.address, bob.pubkey, SIGNET.bitcoinjs)).toBe(true);
    expect(requestBelongsToSender(bob.address.toUpperCase(), bob.pubkey, SIGNET.bitcoinjs)).toBe(true);
  });

  it("refuses someone else's address in the sender's request", () => {
    expect(requestBelongsToSender(mallory.address, bob.pubkey, SIGNET.bitcoinjs)).toBe(false);
  });

  it('refuses addresses that do not parse, or belong to another network', () => {
    expect(requestBelongsToSender('not an address', bob.pubkey, SIGNET.bitcoinjs)).toBe(false);
    expect(requestBelongsToSender('', bob.pubkey, SIGNET.bitcoinjs)).toBe(false);
    expect(requestBelongsToSender(bob.address, bob.pubkey, getNetwork('bitcoin').bitcoinjs)).toBe(false);
  });
});
