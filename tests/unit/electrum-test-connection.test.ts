import { testConnection } from '../../modules/Electrum';
import { getNetwork, setActiveNetwork } from '../../modules/network';

const mockFeatures = jest.fn();

jest.mock('electrum-client', () =>
  jest.fn().mockImplementation(() => ({
    connect: () => Promise.resolve(),
    server_version: () => Promise.resolve(['Fulcrum 1.11', '1.4']),
    server_ping: () => Promise.resolve(null),
    server_features: () => mockFeatures(),
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
