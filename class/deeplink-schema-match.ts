import bip21, { TOptions } from 'bip21';
import * as bitcoin from 'bitcoinjs-lib';
import URL from 'url';
import { Chain } from '../models/bitcoinUnits';
import { ElectrumServerItem, parseElectrumServerString } from '../modules/Electrum';
import { getActiveNetwork } from '../modules/network';
import type { TWallet } from './wallets/types';

type TCompletionHandlerParams = [string, object];
type TContext = {
  wallets: TWallet[];
  saveToDisk: () => void;
  addWallet: (wallet: TWallet) => void;
};

class DeeplinkSchemaMatch {
  static hasSchema(schemaString: string): boolean {
    if (typeof schemaString !== 'string' || schemaString.length <= 0) return false;
    const lower = schemaString.trim().toLowerCase();
    return lower.startsWith('bitcoin:') || lower.startsWith('shroud:');
  }

  /**
   * Examines the URL of the event and dispatches the appropriate navigation route.
   *
   * Supported schemes:
   *   bitcoin:           — standard on-chain payment URI (BIP21)
   *   shroud:bitcoin:    — same, wrapped in the app scheme
   *   shroud://widget?action=  — home-screen widget actions
   *   shroud:setelectrumserver — configure the Electrum server
   *
   * @param event {{url: string}}
   * @param completionHandler {function} Callback that receives [routeName, params]
   */
  static navigationRouteFor(
    event: { url: string },
    completionHandler: (args: TCompletionHandlerParams) => void,
    context: TContext = { wallets: [], saveToDisk: () => {}, addWallet: () => {} },
  ) {
    if (!event.url || typeof event.url !== 'string') return;

    const lower = event.url.toLowerCase();

    // rip out the shroud: wrapper from shroud:bitcoin: (or shroud:BITCOIN:) URIs.
    if (lower.startsWith('shroud:bitcoin:')) {
      event.url = event.url.substring('shroud:'.length);
    } else if (lower.startsWith('shroud://widget?action=')) {
      event.url = event.url.substring('shroud://'.length);
    }

    if (DeeplinkSchemaMatch.isWidgetAction(event.url)) {
      const wallet = context.wallets[0];
      if (wallet?.chain === Chain.ONCHAIN) {
        const action = event.url.split('widget?action=')[1];
        if (action === 'openSend') {
          completionHandler(['SendDetailsRoot', { screen: 'SendDetails', params: { walletID: wallet.getID() } }]);
        } else if (action === 'openReceive') {
          completionHandler(['DetailViewStackScreensStack', { screen: 'ReceiveDetails', params: { walletID: wallet.getID() } }]);
        }
      }
      return;
    }

    if (DeeplinkSchemaMatch.isBitcoinAddress(event.url)) {
      completionHandler(['SendDetailsRoot', { screen: 'SendDetails', params: { uri: event.url.replace('://', ':') } }]);
      return;
    }

    const urlObject = URL.parse(event.url, true); // eslint-disable-line n/no-deprecated-api
    if (urlObject.protocol === 'shroud:') {
      switch (urlObject.host) {
        case 'setelectrumserver': {
          const server = DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(event.url);
          completionHandler(['ElectrumServerSettings', { server: server || undefined }]);
          break;
        }
      }
    }
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
    return parseElectrumServerString(decodeURIComponent(parts[1])) ?? false;
  }

  static isBitcoinAddress(address: string): boolean {
    address = address.replace('://', ':').replace('bitcoin:', '').replace('BITCOIN:', '').replace('bitcoin=', '').split('?')[0];
    try {
      bitcoin.address.toOutputScript(address, getActiveNetwork().bitcoinjs);
      return true;
    } catch {
      return false;
    }
  }

  static isWidgetAction(text: string): boolean {
    return text.startsWith('widget?action=');
  }

  static bip21decode(uri?: string) {
    if (!uri) {
      throw new Error('No URI provided');
    }
    let replacedUri = uri;
    for (const replaceMe of ['BITCOIN://', 'bitcoin://', 'BITCOIN:']) {
      replacedUri = replacedUri.replace(replaceMe, 'bitcoin:');
    }

    return bip21.decode(replacedUri);
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

  static decodeBitcoinUri(uri: string) {
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
        if (parsedBitcoinUri.options.label) {
          memo = parsedBitcoinUri.options.label;
        }
      }
    } catch (_) {}
    return { address, amount, memo };
  }
}

export default DeeplinkSchemaMatch;
