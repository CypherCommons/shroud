import DefaultPreference from 'react-native-default-preference';

import { GROUP_IO_SHROUD } from '../../modules/currency';
import { electrumPreferenceKeys, getPreferredServer } from '../../modules/Electrum';
import { setActiveNetwork } from '../../modules/network';

const savePreferredServer = async (networkId: 'bitcoin' | 'testnet4' | 'signet', host: string, ssl: number) => {
  const keys = electrumPreferenceKeys(networkId);
  await DefaultPreference.setName(GROUP_IO_SHROUD);
  await DefaultPreference.set(keys.host, host);
  await DefaultPreference.set(keys.tcp, '');
  await DefaultPreference.set(keys.ssl, String(ssl));
};

describe('Electrum server preference per network', () => {
  beforeEach(async () => {
    setActiveNetwork('bitcoin');
    await DefaultPreference.clearAll();
  });

  afterAll(() => setActiveNetwork('bitcoin'));

  // Mainnet keeps the keys every existing install already wrote under, which is the migration:
  // the value users saved before multi-network support simply *is* their mainnet server.
  it('keeps the original keys for mainnet', () => {
    expect(electrumPreferenceKeys('bitcoin')).toEqual({
      host: 'electrum_host',
      tcp: 'electrum_tcp_port',
      ssl: 'electrum_ssl_port',
    });
  });

  it('gives every test chain its own keys', () => {
    const all = (['bitcoin', 'testnet4', 'signet'] as const).flatMap(id => Object.values(electrumPreferenceKeys(id)));
    expect(new Set(all).size).toBe(9);
  });

  it('carries a server saved before multi-network support forward as the mainnet one', async () => {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    await DefaultPreference.set('electrum_host', 'legacy.example.org');
    await DefaultPreference.set('electrum_tcp_port', '');
    await DefaultPreference.set('electrum_ssl_port', '50002');

    expect(await getPreferredServer()).toEqual({ host: 'legacy.example.org', tcp: undefined, ssl: 50002 });
  });

  // The bug: one global preference meant a mainnet server kept serving test chains (empty
  // scripthash results, test transactions broadcast to a mainnet node) and the reverse.
  it('does not let a mainnet server leak onto a test chain', async () => {
    await savePreferredServer('bitcoin', 'mainnet.example.org', 50002);

    for (const networkId of ['testnet4', 'signet'] as const) {
      setActiveNetwork(networkId);
      expect(await getPreferredServer()).toBeUndefined();
    }
  });

  it('does not let a test-chain server leak back onto mainnet', async () => {
    await savePreferredServer('signet', 'signet.example.org', 50002);

    setActiveNetwork('bitcoin');
    expect(await getPreferredServer()).toBeUndefined();

    setActiveNetwork('signet');
    expect(await getPreferredServer()).toMatchObject({ host: 'signet.example.org', ssl: 50002 });
  });

  it('keeps each chain’s server intact across a switch', async () => {
    await savePreferredServer('bitcoin', 'mainnet.example.org', 50002);
    await savePreferredServer('testnet4', 'testnet4.example.org', 40002);

    setActiveNetwork('testnet4');
    expect(await getPreferredServer()).toMatchObject({ host: 'testnet4.example.org', ssl: 40002 });
    setActiveNetwork('bitcoin');
    expect(await getPreferredServer()).toMatchObject({ host: 'mainnet.example.org', ssl: 50002 });
  });
});
