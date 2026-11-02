import { SilentPaymentIndexer } from '../../modules/SilentPaymentIndexer';
import TorManager from '../../modules/torManager';
import { fetch } from '../../util/fetch';
import { socks5Fetch } from '../../modules/socks5Fetch';
import transactionFixture from '../fixtures/indexerRange';

jest.mock('../../util/fetch');
jest.mock('../../modules/socks5Fetch');
jest.mock('../../modules/torManager', () => ({
  __esModule: true,
  DEFAULT_SOCKS_HOST: '127.0.0.1',
  default: { getInstance: jest.fn() },
}));
const custom = 'https://custom.example';
const builtin = 'https://default.example';
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  jest.resetAllMocks();
  (TorManager.getInstance as jest.Mock).mockReturnValue({ ensureLoaded: async () => {}, settings: { enabled: false }, isTorOnly: false });
});

it('does not commit scan progress beyond the fallback server indexed tip', async () => {
  (fetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url === `${custom}/silent-block/latest-height`) return ok({ height: 200 });
    if (url === `${builtin}/silent-block/latest-height`) return ok({ height: 150 });
    if (url.startsWith(`${custom}/transactions/range`)) throw new Error('custom failed');
    return ok({ transactions: [] });
  });
  const indexer = new SilentPaymentIndexer({ baseUrl: custom, fallback: { baseUrl: builtin } });
  const tip = await indexer.getLatestBlockHeight();
  let watermark = 150;
  const scannedTip = await indexer.scanForwardWithCallback(151, tip.height, async (_txs, end) => {
    watermark = end;
    return 0;
  });
  expect(scannedTip).toBe(150);
  expect(watermark).toBeLessThanOrEqual(150);
});

it('tries the default onion when only the custom onion endpoint is unavailable', async () => {
  let status = 'connected';
  (TorManager.getInstance as jest.Mock).mockReturnValue({
    ensureLoaded: async () => {},
    settings: { enabled: true },
    isTorOnly: true,
    socksPort: 9050,
    get isReady() {
      return status === 'connected';
    },
    get status() {
      return status;
    },
    markUnavailable: () => {
      status = 'unavailable';
    },
    checkConnection: jest.fn().mockResolvedValue(true),
  });
  (socks5Fetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('http://custom.onion')) throw new Error('onion unreachable');
    return ok({ height: 200 });
  });
  const indexer = new SilentPaymentIndexer({
    baseUrl: custom,
    onionUrl: 'http://custom.onion',
    fallback: { baseUrl: builtin, onionUrl: 'http://default.onion' },
  });
  await indexer.getLatestBlockHeight().catch(() => {});
  expect((socks5Fetch as jest.Mock).mock.calls.map(call => call[0])).toContain('http://default.onion/silent-block/latest-height');
});

it('rejects out-of-range transactions before they can advance the wallet scan watermark', async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(ok(transactionFixture))
    .mockResolvedValueOnce(ok({ height: 1000000 }))
    .mockResolvedValueOnce(ok({ transactions: [] }));
  const indexer = new SilentPaymentIndexer({ baseUrl: custom, fallback: { baseUrl: builtin } });
  const response = await indexer.getTransactionsByRange(10, 20);
  expect(response.transactions).toEqual([]);
  expect(indexer.isUsingFallback()).toBe(true);
});

it('scans the indexed part of a fallback range and later resumes the remaining blocks', async () => {
  let fallbackTip = 175;
  (fetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url === `${custom}/silent-block/latest-height`) return ok({ height: 200 });
    if (url === `${builtin}/silent-block/latest-height`) return ok({ height: fallbackTip });
    if (url.startsWith(custom)) throw new Error('custom failed');
    return ok({ transactions: [] });
  });
  const indexer = new SilentPaymentIndexer({ baseUrl: custom, fallback: { baseUrl: builtin } });
  const commit = jest.fn().mockResolvedValue(0);
  await expect(indexer.scanForwardWithCallback(151, 200, commit)).resolves.toBe(175);
  expect(commit.mock.calls.map(call => call[1])).toEqual([175]);
  fallbackTip = 200;
  await expect(indexer.scanForwardWithCallback(176, 200, commit)).resolves.toBe(200);
  expect(commit.mock.calls.map(call => call[1])).toEqual([175, 199, 200]);
});

it('re-anchors scan progress when settings select a lagging indexer during a scan', async () => {
  (fetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.endsWith('/silent-block/latest-height')) return ok({ height: url.startsWith(custom) ? 200 : 60 });
    return ok({ transactions: [] });
  });
  const indexer = new SilentPaymentIndexer({ baseUrl: custom });
  const heights: number[] = [];
  const tip = await indexer.scanForwardWithCallback(1, 200, async (_transactions, end) => {
    heights.push(end);
    if (end === 49) indexer.configure({ baseUrl: builtin });
    return 0;
  });
  expect(heights).toEqual([49, 60]);
  expect(tip).toBe(60);
});

it('rejects out-of-range single-height results without committing them', async () => {
  (fetch as jest.Mock).mockResolvedValue(ok(transactionFixture));
  const indexer = new SilentPaymentIndexer({ baseUrl: custom });
  await expect(indexer.getTransactionsByHeight(10)).rejects.toThrow('invalid indexer response');
});

it('refuses malformed fallback tip metadata before any scan progress is committed', async () => {
  (fetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url === `${custom}/silent-block/latest-height`) return ok({ height: 200 });
    if (url === `${builtin}/silent-block/latest-height`) return ok({ height: 'invalid' });
    throw new Error('custom offline');
  });
  const indexer = new SilentPaymentIndexer({ baseUrl: custom, fallback: { baseUrl: builtin } });
  const commit = jest.fn();
  await expect(indexer.scanForwardWithCallback(151, 200, commit)).rejects.toThrow('Invalid fallback block height');
  expect(commit).not.toHaveBeenCalled();
});
