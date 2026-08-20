import * as bitcoin from 'bitcoinjs-lib';
import { getActiveNetwork } from '../modules/network';

/**
 * Is this a bech32/bech32m address on the given chain (default: the active one)?
 *
 * Wallet code should pass its own `getNetworkConfig().bitcoinjs`: a wallet is pinned to one chain,
 * which need not be the one currently selected.
 *
 * `fromBech32` alone does not check the HRP, so it happily accepts a `tb1` address while the
 * wallet is on mainnet (and vice versa). The prefix is therefore checked explicitly, so a
 * wrong-chain address is rejected here rather than surfacing later as a confusing decode failure
 * — or worse, being treated as payable.
 */
export function isValidBech32Address(address: string, network: bitcoin.Network = getActiveNetwork().bitcoinjs): boolean {
  try {
    const decoded = bitcoin.address.fromBech32(address);
    return decoded.prefix === network.bech32;
  } catch (e) {
    return false;
  }
}
