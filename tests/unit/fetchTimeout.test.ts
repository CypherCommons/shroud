import TorManager from '../../modules/torManager';

jest.mock('../../modules/torManager', () => ({
  __esModule: true,
  DEFAULT_SOCKS_HOST: '127.0.0.1',
  default: { getInstance: jest.fn() },
}));

const originalFetch = globalThis.fetch;
let timedFetch: typeof import('../../util/fetch').fetch;

beforeEach(() => {
  jest.useFakeTimers();
  (TorManager.getInstance as jest.Mock).mockReturnValue({
    ensureLoaded: async () => {},
    settings: { enabled: false },
    isTorOnly: false,
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});
const loadFetch = () =>
  jest.isolateModules(() => {
    timedFetch = require('../../util/fetch').fetch;
  });

it('aborts and rejects a stalled response body after the original request deadline', async () => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = jest.fn(async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return { json: () => new Promise(() => {}) } as Response;
  });
  loadFetch();
  const response = await timedFetch('https://custom.example/transactions/range', { timeout: 8000 });
  const outcome = response.json().catch(error => error);
  await jest.advanceTimersByTimeAsync(9000);
  expect(await outcome).toEqual(new Error('Request timed out after 8000ms'));
  expect(signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

it('cleans up the deadline when a body finishes successfully', async () => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = jest.fn(async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return { json: async () => ({ height: 200 }) } as Response;
  });
  loadFetch();
  const response = await timedFetch('https://custom.example', { timeout: 8000 });
  await expect(response.json()).resolves.toEqual({ height: 200 });
  expect(jest.getTimerCount()).toBe(0);
  await jest.advanceTimersByTimeAsync(9000);
  expect(signal?.aborted).toBe(false);
});

it('cleans up the deadline when fetching headers fails', async () => {
  globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  loadFetch();
  await expect(timedFetch('https://custom.example')).rejects.toThrow('offline');
  expect(jest.getTimerCount()).toBe(0);
});

it('falls back to the default when a custom indexer sends headers but stalls its body', async () => {
  globalThis.fetch = jest.fn(
    async url =>
      ({
        ok: true,
        status: 200,
        json: () => (String(url).startsWith('https://custom.example') ? new Promise(() => {}) : Promise.resolve({ height: 200 })),
      }) as Response,
  );
  let Indexer!: typeof import('../../modules/SilentPaymentIndexer').SilentPaymentIndexer;
  jest.isolateModules(() => {
    Indexer = require('../../modules/SilentPaymentIndexer').SilentPaymentIndexer;
  });
  const indexer = new Indexer({ baseUrl: 'https://custom.example', fallback: { baseUrl: 'https://default.example' } });
  const request = indexer.getLatestBlockHeight();
  await jest.advanceTimersByTimeAsync(9000);
  await expect(request).resolves.toEqual({ height: 200 });
  expect(indexer.isUsingFallback()).toBe(true);
});
