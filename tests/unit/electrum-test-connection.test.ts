import DefaultPreference from 'react-native-default-preference';

import presentAlert from '../../components/Alert';
import { GROUP_IO_SHROUD } from '../../modules/currency';
import { connectMain, electrumPreferenceKeys, forceDisconnect, testConnection } from '../../modules/Electrum';
import { getNetwork, setActiveNetwork } from '../../modules/network';

jest.mock('../../components/Alert');

const mockFeatures = jest.fn();

const ElectrumClient = require('electrum-client');

jest.mock('electrum-client', () =>
  jest.fn().mockImplementation(() => ({
    initElectrum: () => Promise.resolve(['Fulcrum 1.11', '1.4']),
    server_features: () => mockFeatures(),
    blockchainHeaders_subscribe: () => Promise.resolve({ height: 900000, hex: '00' }),
    close: () => {},
  })),
);

describe('Electrum testConnection', () => {
  afterEach(() => setActiveNetwork('bitcoin'));

  it('accepts a server on the active chain', async () => {
    setActiveNetwork('signet');
    mockFeatures.mockResolvedValue({ genesis_hash: getNetwork('signet').genesisHash });

    await expect(testConnection('signet.example.org', undefined, 50002)).resolves.toBe(true);
  });

  it('matches the genesis hash whatever its case', async () => {
    mockFeatures.mockResolvedValue({ genesis_hash: getNetwork('bitcoin').genesisHash.toUpperCase() });

    await expect(testConnection('mainnet.example.org', undefined, 50002)).resolves.toBe(true);
  });

  it('rejects a server for another chain, naming the one it should be on', async () => {
    setActiveNetwork('signet');
    mockFeatures.mockResolvedValue({ genesis_hash: getNetwork('bitcoin').genesisHash });

    await expect(testConnection('mainnet.example.org', undefined, 50002)).rejects.toThrow('Signet');
  });

  it('checks against the chain it is given rather than the active one', async () => {
    mockFeatures.mockResolvedValue({ genesis_hash: getNetwork('signet').genesisHash });

    await expect(testConnection('signet.example.org', undefined, 50002, 'signet')).resolves.toBe(true);
    await expect(testConnection('signet.example.org', undefined, 50002, 'bitcoin')).rejects.toThrow('Mainnet');
  });

  it('rejects a server that does not say which chain it serves', async () => {
    mockFeatures.mockResolvedValue({});

    await expect(testConnection('mainnet.example.org', undefined, 50002)).rejects.toThrow();
  });

  it('still reports an unreachable server as false', async () => {
    mockFeatures.mockRejectedValue(new Error('socket closed'));

    await expect(testConnection('mainnet.example.org', undefined, 50002)).resolves.toBe(false);
  });
});

// The same handshake guards every real connection, not just the save-time check: a shipped peer
// with a wrong port, or a saved server whose operator switched chains, is refused here too.
describe('Electrum connectMain', () => {
  afterEach(() => {
    forceDisconnect();
    setActiveNetwork('bitcoin');
    jest.mocked(presentAlert).mockClear();
  });

  it('connects to a peer on the active chain', async () => {
    mockFeatures.mockResolvedValue({ genesis_hash: getNetwork('bitcoin').genesisHash });

    await connectMain();

    expect(presentAlert).not.toHaveBeenCalled();
  });

  it('refuses a peer on another chain and says which chain it should be on', async () => {
    mockFeatures.mockResolvedValue({ genesis_hash: getNetwork('signet').genesisHash });

    await connectMain();

    expect(presentAlert).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Mainnet') }));
  });

  // The saved server overrides peer rotation, so "try again" meets the same server. Each refusal
  // has to say which server, or the alert's duplicate check would swallow every one after the first.
  it('refuses a saved server on another chain every time, naming it, and does not fall back to shipped peers', async () => {
    const keys = electrumPreferenceKeys('bitcoin');
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    await DefaultPreference.set(keys.host, 'signet.example.org');
    await DefaultPreference.set(keys.ssl, '50002');
    mockFeatures.mockResolvedValue({ genesis_hash: getNetwork('signet').genesisHash });
    jest.mocked(ElectrumClient).mockClear();

    try {
      await connectMain();
      await connectMain();

      expect(presentAlert).toHaveBeenCalledTimes(2);
      expect(presentAlert).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: expect.stringContaining('signet.example.org:50002 is not on Mainnet') }),
      );
      // every attempt went to the saved server, none to a shipped peer
      expect(jest.mocked(ElectrumClient).mock.calls.map((args: unknown[]) => args[3])).toEqual([
        'signet.example.org',
        'signet.example.org',
      ]);
    } finally {
      await DefaultPreference.clearAll();
    }
  });
});
