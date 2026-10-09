import assert from 'assert';
import { IndexerHttpClient } from '../../helpers/silent-payments/IndexerHttpClient';
import { socks5Fetch } from '../../modules/socks5Fetch';
import TorManager from '../../modules/torManager';
import type { TorStatus } from '../../modules/torManager';
import { fetch } from '../../util/fetch';

jest.mock('../../modules/socks5Fetch');
jest.mock('../../util/fetch');
jest.mock('../../modules/torManager', () => {
  const actual = jest.requireActual('../../modules/torManager');
  return {
    __esModule: true,
    DEFAULT_SOCKS_HOST: actual.DEFAULT_SOCKS_HOST,
    default: {
      getInstance: jest.fn(),
    },
  };
});

const mockSocks5Fetch = socks5Fetch as jest.Mock;
const mockFetch = fetch as jest.Mock;
const mockGetInstance = TorManager.getInstance as jest.Mock;

const okJsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

// Mirrors the real TorManager: isReady/isTorOnly/socksPort are derived from status/settings
// rather than independently settable, so a test can't put the mock into a state production
// can't reach (e.g. isReady: true while status stays 'disabled').
function createTorManagerMock() {
  const state: { settings: { enabled: boolean; torOnly: boolean; socksPort: number }; status: TorStatus } = {
    settings: { enabled: false, torOnly: false, socksPort: 9050 },
    status: 'disabled',
  };
  return {
    ensureLoaded: jest.fn().mockResolvedValue(undefined),
    markUnavailable: jest.fn(),
    get settings() {
      return state.settings;
    },
    set settings(value) {
      state.settings = value;
    },
    get status() {
      return state.status;
    },
    set status(value) {
      state.status = value;
    },
    get socksPort() {
      return state.settings.socksPort;
    },
    get isReady() {
      return state.status === 'connected';
    },
    get isTorOnly() {
      return state.settings.enabled && state.settings.torOnly;
    },
  };
}

describe('unit - IndexerHttpClient Tor routing', () => {
  let torManagerMock: ReturnType<typeof createTorManagerMock>;

  beforeEach(() => {
    mockSocks5Fetch.mockReset();
    mockFetch.mockReset();
    torManagerMock = createTorManagerMock();
    mockGetInstance.mockReturnValue(torManagerMock);
  });

  it('waits for Tor settings to load before deciding how to route the request', async () => {
    mockFetch.mockResolvedValue(okJsonResponse({ ok: true }));
    const client = new IndexerHttpClient('https://clearnet.example', 1000);

    await client.get('/status', 'test');

    assert.strictEqual(torManagerMock.ensureLoaded.mock.calls.length, 1);
  });

  it('attempts Tor while a connection probe is still in flight instead of failing immediately', async () => {
    torManagerMock.settings = { enabled: true, torOnly: false, socksPort: 9050 };
    torManagerMock.status = 'checking';
    mockSocks5Fetch.mockResolvedValue(okJsonResponse({ ok: true }));

    const client = new IndexerHttpClient('https://clearnet.example', 1000, 'http://abc123.onion');
    const result = await client.get('/status', 'test');

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(mockSocks5Fetch.mock.calls.length, 1);
    assert.strictEqual(mockFetch.mock.calls.length, 0);
  });

  it('never falls back to clearnet when Tor-only mode is enabled and Tor is unreachable', async () => {
    torManagerMock.settings = { enabled: true, torOnly: true, socksPort: 9050 };
    torManagerMock.status = 'connected';
    mockSocks5Fetch.mockRejectedValue(new Error('connection refused'));

    const client = new IndexerHttpClient('https://clearnet.example', 1000, 'http://abc123.onion');

    await assert.rejects(client.get('/status', 'test'), /Tor-only mode is enabled but Tor is unavailable/);
    assert.strictEqual(mockFetch.mock.calls.length, 0);
    assert.strictEqual(torManagerMock.markUnavailable.mock.calls.length, 1);
  }, 10000);

  it('never falls back to clearnet when Tor-only mode is enabled but no onion URL is configured', async () => {
    torManagerMock.settings = { enabled: true, torOnly: true, socksPort: 9050 };

    const client = new IndexerHttpClient('https://clearnet.example', 1000);

    await assert.rejects(client.get('/status', 'test'), /no \.onion URL is configured/);
    assert.strictEqual(mockSocks5Fetch.mock.calls.length, 0);
    assert.strictEqual(mockFetch.mock.calls.length, 0);
  });

  it('falls back to clearnet when Tor is enabled (not Tor-only) and Tor is unreachable', async () => {
    torManagerMock.settings = { enabled: true, torOnly: false, socksPort: 9050 };
    torManagerMock.status = 'connected';
    mockSocks5Fetch.mockRejectedValue(new Error('connection refused'));
    mockFetch.mockResolvedValue(okJsonResponse({ ok: true }));

    const client = new IndexerHttpClient('https://clearnet.example', 1000, 'http://abc123.onion');
    const result = await client.get('/status', 'test');

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(mockFetch.mock.calls.length, 1);
  }, 10000);

  it('stops retrying Tor after a definitive 4xx instead of burning all attempts on it', async () => {
    torManagerMock.settings = { enabled: true, torOnly: false, socksPort: 9050 };
    torManagerMock.status = 'connected';
    mockSocks5Fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const client = new IndexerHttpClient('https://clearnet.example', 1000, 'http://abc123.onion');
    await assert.rejects(client.get('/status', 'test'), /HTTP error! status: 404/);

    assert.strictEqual(mockSocks5Fetch.mock.calls.length, 1);
  });

  it('does not fall back to clearnet or mark Tor unavailable on a definitive 4xx, since Tor demonstrably worked', async () => {
    torManagerMock.settings = { enabled: true, torOnly: false, socksPort: 9050 };
    torManagerMock.status = 'connected';
    mockSocks5Fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const client = new IndexerHttpClient('https://clearnet.example', 1000, 'http://abc123.onion');
    await assert.rejects(client.get('/status', 'test'));

    assert.strictEqual(mockFetch.mock.calls.length, 0);
    assert.strictEqual(torManagerMock.markUnavailable.mock.calls.length, 0);
  });

  it('falls back to clearnet without marking Tor unavailable when Tor exhausts retries on a 5xx, since the onion service answered', async () => {
    torManagerMock.settings = { enabled: true, torOnly: false, socksPort: 9050 };
    torManagerMock.status = 'connected';
    mockSocks5Fetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    mockFetch.mockResolvedValue(okJsonResponse({ ok: true }));

    const client = new IndexerHttpClient('https://clearnet.example', 1000, 'http://abc123.onion');
    const result = await client.get('/status', 'test');

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(mockFetch.mock.calls.length, 1);
    assert.strictEqual(torManagerMock.markUnavailable.mock.calls.length, 0);
  }, 10000);

  it('retries a 429 with backoff instead of treating it as a definitive 4xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) }).mockResolvedValue(okJsonResponse({ ok: true }));

    const client = new IndexerHttpClient('https://clearnet.example', 1000);
    const result = await client.get('/status', 'test');

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(mockFetch.mock.calls.length, 2);
  }, 10000);

  it('goes straight to clearnet without attempting Tor when Tor is disabled', async () => {
    mockFetch.mockResolvedValue(okJsonResponse({ ok: true }));

    const client = new IndexerHttpClient('https://clearnet.example', 1000, 'http://abc123.onion');
    await client.get('/status', 'test');

    assert.strictEqual(mockSocks5Fetch.mock.calls.length, 0);
    assert.strictEqual(mockFetch.mock.calls.length, 1);
  });
});
