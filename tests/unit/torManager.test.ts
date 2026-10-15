import assert from 'assert';
import { EventEmitter } from 'events';
import TcpSocket from 'react-native-tcp-socket';
import DefaultPreference from 'react-native-default-preference';
import { Linking, Platform } from 'react-native';
import TorManager from '../../modules/torManager';

jest.mock('react-native-tcp-socket', () => {
  class FakeTcpSocket extends EventEmitter {
    write = jest.fn();
    destroy = jest.fn();
  }
  return {
    __esModule: true,
    default: {
      createConnection: jest.fn((_options: unknown, callback: () => void) => {
        const socket = new FakeTcpSocket();
        setImmediate(callback);
        return socket;
      }),
    },
  };
});

const mockCreateConnection = TcpSocket.createConnection as jest.Mock;
const mockSet = DefaultPreference.set as jest.Mock;

const latestSocket = (): EventEmitter => {
  const results = mockCreateConnection.mock.results;
  return results[results.length - 1].value;
};

const flush = () => new Promise(resolve => setImmediate(resolve));

const SOCKS5_ACCEPT = Buffer.from([0x05, 0x00]);
const SOCKS5_REJECT = Buffer.from([0x05, 0xff]);

describe('unit - TorManager', () => {
  const torManager = TorManager.getInstance();

  beforeEach(async () => {
    mockCreateConnection.mockClear();
    await torManager.setEnabled(false);
  });

  it('reports connected when the SOCKS5 proxy accepts the probe', async () => {
    const promise = torManager.setSocksPort(9050).then(() => torManager.setEnabled(true));
    await flush();
    latestSocket().emit('data', SOCKS5_ACCEPT);
    await promise;

    assert.strictEqual(torManager.status, 'connected');
    assert.strictEqual(torManager.isReady, true);
  });

  it('reports unavailable when the SOCKS5 proxy rejects the probe', async () => {
    const promise = torManager.setEnabled(true);
    await flush();
    latestSocket().emit('data', SOCKS5_REJECT);
    await promise;

    assert.strictEqual(torManager.status, 'unavailable');
  });

  it('ignores a stale checkConnection result if settings changed while the probe was in flight', async () => {
    const enablePromise = torManager.setEnabled(true);
    await flush();
    const staleSocket = latestSocket();

    // Disable Tor before the in-flight probe resolves.
    await torManager.setEnabled(false);
    assert.strictEqual(torManager.status, 'disabled');

    // The stale probe now resolves successfully - it must not overwrite 'disabled'.
    staleSocket.emit('data', SOCKS5_ACCEPT);
    await enablePromise;

    assert.strictEqual(torManager.status, 'disabled');
  });

  it('schedules a retry after markUnavailable instead of latching unavailable forever', async () => {
    const enablePromise = torManager.setEnabled(true);
    await flush();
    latestSocket().emit('data', SOCKS5_ACCEPT);
    await enablePromise;
    assert.strictEqual(torManager.status, 'connected');

    mockCreateConnection.mockClear();
    jest.useFakeTimers();
    try {
      // markUnavailable schedules its retry via a real setTimeout at call time, so the fake
      // clock must already be active before calling it for advanceTimersByTime to see it.
      torManager.markUnavailable();
      assert.strictEqual(torManager.status, 'unavailable');
      jest.advanceTimersByTime(30000);
    } finally {
      jest.useRealTimers();
    }
    await flush();

    assert.strictEqual(mockCreateConnection.mock.calls.length, 1, 'the cooldown should have triggered a fresh probe');
    latestSocket().emit('data', SOCKS5_ACCEPT);
    await flush();
    assert.strictEqual(torManager.status, 'connected');
  });

  it('keeps rescheduling retries as long as each probe keeps failing', async () => {
    const enablePromise = torManager.setEnabled(true);
    await flush();
    latestSocket().emit('data', SOCKS5_ACCEPT);
    await enablePromise;
    assert.strictEqual(torManager.status, 'connected');

    mockCreateConnection.mockClear();
    // Every retry timer in this chain is scheduled via a real setTimeout at the moment it's
    // created, so the fake clock must stay active for the whole sequence - advanceTimersByTime
    // can't see a timer that was scheduled before (or after switching back from) fake timers.
    jest.useFakeTimers();
    try {
      torManager.markUnavailable();
      assert.strictEqual(torManager.status, 'unavailable');

      // First scheduled retry fires and probes again.
      jest.advanceTimersByTime(30000);
      assert.strictEqual(mockCreateConnection.mock.calls.length, 1, 'the first cooldown should have triggered a fresh probe');

      // That probe fails too - before the fix, checkConnection's failure path never
      // rescheduled, so nothing would probe again after this point.
      latestSocket().emit('data', SOCKS5_REJECT);
      // Fake timers only fake macrotask timer APIs, not native promise microtasks - these let
      // checkConnection's `await this._testSocksProxy()` continuation actually run.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      assert.strictEqual(torManager.status, 'unavailable');

      // A second retry must still be scheduled - this is the fix under test.
      jest.advanceTimersByTime(30000);
      assert.strictEqual(mockCreateConnection.mock.calls.length, 2, 'a second cooldown should have triggered another probe');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not update in-memory settings when persisting them fails', async () => {
    mockSet.mockRejectedValueOnce(new Error('disk full'));
    await torManager.setTorOnly(true);

    assert.strictEqual(torManager.settings.torOnly, false);
  });
});

describe('unit - TorManager.isOrbotInstalled on iOS', () => {
  const canOpenURL = Linking.canOpenURL as jest.Mock;

  beforeEach(() => {
    assert.strictEqual(Platform.OS, 'ios');
    canOpenURL.mockClear();
  });

  it('detects Orbot through the orbot: scheme it registers', async () => {
    canOpenURL.mockResolvedValueOnce(true);

    assert.strictEqual(await TorManager.isOrbotInstalled(), true);
    assert.strictEqual(canOpenURL.mock.calls.length, 1);
    assert.strictEqual(canOpenURL.mock.calls[0][0], 'orbot:show');
  });

  it('reports Orbot missing when nothing handles the scheme', async () => {
    canOpenURL.mockResolvedValueOnce(false);

    assert.strictEqual(await TorManager.isOrbotInstalled(), false);
  });

  it('reports Orbot missing when canOpenURL rejects', async () => {
    // React Native rejects for a scheme missing from LSApplicationQueriesSchemes.
    canOpenURL.mockRejectedValueOnce(new Error('Unable to open URL: orbot:show'));

    assert.strictEqual(await TorManager.isOrbotInstalled(), false);
  });
});
