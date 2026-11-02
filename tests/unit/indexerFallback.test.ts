import { SilentPaymentIndexer } from '../../modules/SilentPaymentIndexer';
import TorManager from '../../modules/torManager';
import { fetch } from '../../util/fetch';
import { socks5Fetch } from '../../modules/socks5Fetch';

jest.mock('../../util/fetch');
jest.mock('../../modules/socks5Fetch');
jest.mock('../../modules/torManager', () => ({
  __esModule: true,
  DEFAULT_SOCKS_HOST: '127.0.0.1',
  default: { getInstance: jest.fn() },
}));

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const mockFetch = fetch as jest.Mock;
const mockSocks = socks5Fetch as jest.Mock;
const custom = 'https://custom.example';
const builtin = 'https://default.example';
const config = { baseUrl: custom, timeout: 8000, fallback: { baseUrl: builtin, onionUrl: 'http://default.onion' } };
let tor: any;

beforeEach(() => {
  jest.resetAllMocks();
  tor = {
    ensureLoaded: jest.fn().mockResolvedValue(undefined),
    settings: { enabled: false },
    isTorOnly: false,
    isReady: false,
    status: 'disabled',
    socksPort: 9050,
    markUnavailable: jest.fn(),
    checkConnection: jest.fn().mockResolvedValue(true),
  };
  (TorManager.getInstance as jest.Mock).mockReturnValue(tor);
});

it('uses the custom endpoint while it works', async () => {
  mockFetch.mockResolvedValue(ok({ height: 900000 }));
  const indexer = new SilentPaymentIndexer(config);
  await expect(indexer.getLatestBlockHeight()).resolves.toEqual({ height: 900000 });
  expect(mockFetch.mock.calls.map(call => call[0])).toEqual([`${custom}/silent-block/latest-height`]);
  expect(indexer.isUsingFallback()).toBe(false);
});

it('retries a failed request on the default and uses the default on subsequent requests', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(ok({ height: 900000 }));
  const indexer = new SilentPaymentIndexer(config);
  await indexer.getLatestBlockHeight();
  await indexer.getLatestBlockHeight();
  expect(mockFetch.mock.calls.map(call => call[0])).toEqual([
    `${custom}/silent-block/latest-height`,
    `${builtin}/silent-block/latest-height`,
    `${builtin}/silent-block/latest-height`,
  ]);
  expect(indexer.isUsingFallback()).toBe(true);
  expect(indexer.getBaseUrl()).toBe(builtin);
});

it('falls back for malformed transaction batches instead of treating them as scanned', async () => {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/silent-block/latest-height')) return ok({ height: 100 });
    return ok({ transactions: url.startsWith(custom) ? [{}] : [] });
  });
  const indexer = new SilentPaymentIndexer(config);
  const commit = jest.fn().mockResolvedValue(0);
  await indexer.scanForwardWithCallback(10, 20, commit);
  expect(commit).toHaveBeenCalledWith([], 20);
  expect(indexer.isUsingFallback()).toBe(true);
});

it('propagates failure if neither endpoint returns a valid response', async () => {
  mockFetch.mockResolvedValue(ok({ height: 'invalid' }));
  await expect(new SilentPaymentIndexer(config).getLatestBlockHeight()).rejects.toThrow('invalid indexer response');
});

it('does not use fallback when testing an endpoint without fallback configured', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  await expect(new SilentPaymentIndexer({ baseUrl: custom }).getLatestBlockHeight()).rejects.toThrow('offline');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('respects Tor-only mode and uses the default onion when the custom endpoint has no onion', async () => {
  tor.settings.enabled = true;
  tor.isTorOnly = true;
  tor.isReady = true;
  tor.status = 'connected';
  mockSocks.mockResolvedValue(ok({ height: 900000 }));
  const indexer = new SilentPaymentIndexer(config);
  await indexer.getLatestBlockHeight();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockSocks.mock.calls[0][0]).toBe('http://default.onion/silent-block/latest-height');
  expect(indexer.isUsingFallback()).toBe(true);
});

it('keeps a newly saved configuration when an older in-flight request falls back', async () => {
  let rejectRequest!: (error: Error) => void;
  mockFetch.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
  );
  mockFetch.mockResolvedValue(ok({ height: 900000 }));
  const indexer = new SilentPaymentIndexer(config);
  const pending = indexer.getLatestBlockHeight();
  await Promise.resolve();
  await Promise.resolve();
  indexer.configure({ baseUrl: 'https://new.example' });
  rejectRequest(new Error('offline'));
  await pending;
  expect(indexer.getBaseUrl()).toBe('https://new.example');
  expect(indexer.isUsingFallback()).toBe(false);
});

it('retries the custom indexer after an explicit reconfiguration', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(ok({ height: 900000 }));
  const indexer = new SilentPaymentIndexer(config);
  await indexer.getLatestBlockHeight();
  indexer.configure(config);
  await indexer.getLatestBlockHeight();
  expect(indexer.isUsingFallback()).toBe(false);
  expect(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0]).toBe(`${custom}/silent-block/latest-height`);
});

it('never falls back to clearnet when Tor-only mode has no working Tor connection', async () => {
  tor.settings.enabled = true;
  tor.isTorOnly = true;
  await expect(new SilentPaymentIndexer(config).getLatestBlockHeight()).rejects.toThrow('Tor-only mode');
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockSocks).not.toHaveBeenCalled();
});
