import bip21, { TOptions } from 'bip21';
import * as bitcoin from 'bitcoinjs-lib';
import { ElectrumServerItem, parseElectrumServerString } from '../modules/Electrum';
import { getActiveNetwork, getAllNetworks } from '../modules/network';
import { isSilentPaymentAddress } from '../helpers/silent-payments';

export type TScanError = 'wrong_network' | 'unrecognized';
type TScanDestination = { send: string } | { electrumServer: ElectrumServerItem } | { error: TScanError };

class DeeplinkSchemaMatch {
  static hasSchema(schemaString: string): boolean {
    if (typeof schemaString !== 'string' || schemaString.length <= 0) return false;
    const lower = schemaString.trim().toLowerCase();
    return lower.startsWith('bitcoin:') || lower.startsWith('shroud:');
  }

  /**
   * Maps scanned or pasted input to where it should open, or to the reason it can't.
   *
   * Supported schemes:
   *   bitcoin:           — payment URI (BIP21), including silent-payment addresses
   *   shroud:bitcoin:    — same, wrapped in the app scheme
   *   shroud:setelectrumserver — configure the Electrum server
   */
  static destinationFor(input: string): TScanDestination {
    const uri = DeeplinkSchemaMatch.canonicalise(input);
    const address = DeeplinkSchemaMatch.extractAddress(uri);

    if (DeeplinkSchemaMatch.isValidAddress(address, getActiveNetwork().bitcoinjs)) {
      return { send: uri };
    }

    if (uri.toLowerCase().startsWith('shroud:setelectrumserver')) {
      const server = DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(uri);
      return server ? { electrumServer: server } : { error: 'unrecognized' };
    }

    // The active network already failed above, so any match is another chain. Disabled networks
    // count too: their addresses are just as unpayable from here.
    if (getAllNetworks().some(n => DeeplinkSchemaMatch.isValidAddress(address, n.bitcoinjs))) {
      return { error: 'wrong_network' };
    }

    // TODO: BIP-321 `sp=` query param (e.g. `bitcoin:?sp=sp1q…`) is not routed yet.
    return { error: 'unrecognized' };
  }

  /**
   * Extracts the server from a deeplink like `shroud:setelectrumserver?server=electrum.example.com%3A443%3As`.
   * Returns false if the URL is not a valid setelectrumserver action.
   */
  static getServerFromSetElectrumServerAction(url: string): ElectrumServerItem | false {
    const lower = url.toLowerCase();
    if (!lower.startsWith('shroud:setelectrumserver') && !lower.startsWith('setelectrumserver')) {
      return false;
    }
    const parts = url.split('server=');
    if (!parts[1]) return false;
    let server: string;
    try {
      server = decodeURIComponent(parts[1]);
    } catch {
      // Malformed `%` escape.
      return false;
    }
    return parseElectrumServerString(server) ?? false;
  }

  /** Trims, unwraps `shroud:bitcoin:` and rewrites a leading `bitcoin:` / `bitcoin://` in any case to `bitcoin:`. */
  private static canonicalise(input: string): string {
    return input.trim().replace(/^(?:shroud:)?bitcoin:(?:\/\/)?/i, 'bitcoin:');
  }

  /** Takes a canonical URI or a bare address. */
  private static extractAddress(uri: string): string {
    return uri.replace(/^bitcoin:/, '').split('?')[0];
  }

  /** Includes silent-payment addresses. */
  private static isValidAddress(address: string, network: bitcoin.Network): boolean {
    if (isSilentPaymentAddress(address, network)) return true;
    try {
      bitcoin.address.toOutputScript(address, network);
      return true;
    } catch {
      return false;
    }
  }

  static bip21decode(uri?: string) {
    if (!uri) {
      throw new Error('No URI provided');
    }
    return bip21.decode(DeeplinkSchemaMatch.canonicalise(uri));
  }

  static bip21encode(address: string, options?: TOptions): string {
    // uppercase address if bech32 to satisfy BIP_0173
    const isBech32 = address.toLowerCase().startsWith(`${getActiveNetwork().bitcoinjs.bech32}1`);
    if (isBech32) {
      address = address.toUpperCase();
    }

    for (const key in options) {
      if (key === 'label' && String(options[key]).replace(' ', '').length === 0) {
        delete options[key];
      }
      if (key === 'amount' && !(Number(options[key]) > 0)) {
        delete options[key];
      }
    }
    return bip21.encode(address, options);
  }

  /**
   * What a payment request fills in on the send form. Never throws: input that isn't a URI comes
   * back as the address, and a `bitcoin:` URI with an option bip21 rejects (a malformed amount)
   * still yields the address in front of its `?`.
   */
  static decodeBitcoinUri(uri: string): { address: string; amount?: number; memo: string } {
    let amount;
    let address = uri || '';
    let memo = '';
    try {
      const parsedBitcoinUri = DeeplinkSchemaMatch.bip21decode(uri);
      address = parsedBitcoinUri.address ? parsedBitcoinUri.address.toString() : address;
      if ('options' in parsedBitcoinUri) {
        if (parsedBitcoinUri.options.amount) {
          amount = Number(parsedBitcoinUri.options.amount);
        }
        // qs turns a repeated or bracketed key into an array or an object, whatever bip21's types say
        if (typeof parsedBitcoinUri.options.label === 'string') {
          memo = parsedBitcoinUri.options.label;
        }
      }
    } catch (_) {
      const canonical = DeeplinkSchemaMatch.canonicalise(address);
      if (canonical.startsWith('bitcoin:')) {
        address = DeeplinkSchemaMatch.extractAddress(canonical) || address;
      }
    }
    return { address, amount, memo };
  }
}

export default DeeplinkSchemaMatch;
