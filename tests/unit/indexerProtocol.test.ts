import { SilentPaymentIndexer } from '../../modules/SilentPaymentIndexer';
import TorManager from '../../modules/torManager';
import { fetch } from '../../util/fetch';
import { socks5Fetch } from '../../modules/socks5Fetch';
import rangeResponse from '../fixtures/indexerRange';

jest.mock('../../util/fetch');
jest.mock('../../modules/socks5Fetch');
jest.mock('../../modules/torManager', () => ({
  __esModule: true,
  DEFAULT_SOCKS_HOST: '127.0.0.1',
  default: { getInstance: jest.fn() },
}));

const config = { baseUrl: 'https://custom.example', fallback: { baseUrl: 'https://default.example' } };
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

beforeEach(() => {
  jest.resetAllMocks();
  (TorManager.getInstance as jest.Mock).mockReturnValue({
    ensureLoaded: jest.fn().mockResolvedValue(undefined),
    settings: { enabled: false },
    isTorOnly: false,
  });
});

it('accepts a real indexer transaction batch without optional isSpent fields and commits scan progress', async () => {
  (fetch as jest.Mock).mockImplementation(async (url: string) =>
    response(url.endsWith('/silent-block/latest-height') ? { height: 900000 } : rangeResponse),
  );
  const indexer = new SilentPaymentIndexer(config);
  const commit = jest.fn().mockResolvedValue(0);
  await indexer.scanForwardWithCallback(900000, 900000, commit);
  expect(commit).toHaveBeenCalledWith(rangeResponse.transactions, 900000);
  expect(indexer.isUsingFallback()).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('accepts the deployed plain-text HEALTHY health response', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => 'HEALTHY\n',
    json: async () => {
      throw new Error('not JSON');
    },
  });
  await expect(new SilentPaymentIndexer(config).getHealth()).resolves.toEqual({ status: 'healthy' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('continues accepting a JSON health response', async () => {
  (fetch as jest.Mock).mockResolvedValue({ ...response({ status: 'ok' }), text: async () => '{"status":"ok"}' });
  await expect(new SilentPaymentIndexer(config).getHealth()).resolves.toEqual({ status: 'ok' });
});

it('parses a plain-text health response over Tor without touching clearnet', async () => {
  (TorManager.getInstance as jest.Mock).mockReturnValue({
    ensureLoaded: jest.fn().mockResolvedValue(undefined),
    settings: { enabled: true },
    isTorOnly: true,
    isReady: true,
    status: 'connected',
    socksPort: 9050,
  });
  (socks5Fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => 'HEALTHY',
    json: async () => {
      throw new Error('not JSON');
    },
  });
  await expect(new SilentPaymentIndexer({ ...config, onionUrl: 'http://custom.onion' }).getHealth()).resolves.toEqual({
    status: 'healthy',
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('still rejects malformed transactions and retries them on the default', async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(response({ transactions: [{ id: 'incomplete' }] }))
    .mockResolvedValueOnce(response({ height: 900000 }))
    .mockResolvedValueOnce(response(rangeResponse));
  const indexer = new SilentPaymentIndexer(config);
  await expect(indexer.getTransactionsByRange(900000, 900000)).resolves.toEqual(rangeResponse);
  expect(indexer.isUsingFallback()).toBe(true);
});
