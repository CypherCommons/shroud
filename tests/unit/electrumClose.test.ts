import { closeElectrumClient } from '../../modules/Electrum';

const ElectrumClient = require('electrum-client');

/** Just enough of a socket for electrum-client, whose events a test can fire. */
class FakeSocket {
  private listeners: Record<string, ((arg?: unknown) => void)[]> = {};
  setTimeout() {}
  setEncoding() {}
  setKeepAlive() {}
  setNoDelay() {}
  write() {}
  end() {}
  destroy() {}
  on(event: string, listener: (arg?: unknown) => void) {
    (this.listeners[event] ??= []).push(listener);
  }

  emit(event: string, arg?: unknown) {
    this.listeners[event]?.forEach(listener => listener(arg));
  }
}

/** A client that looks connected, with a ping waiting on an answer. */
const clientWithRequestInFlight = () => {
  const client = new ElectrumClient({ Socket: FakeSocket }, null, 50001, 'electrum.example', 'tcp');
  client.status = 1;
  const socket: FakeSocket = client.conn;
  let settled = false;
  const ping = client.server_ping().finally(() => {
    settled = true;
  });
  return { client, socket, ping, isSettled: () => settled };
};

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('closeElectrumClient', () => {
  it('fails the requests still waiting on the client', async () => {
    const { client, ping } = clientWithRequestInFlight();

    closeElectrumClient(client);

    await expect(ping).rejects.toThrow('Electrum connection closed');
    expect(client.callback_message_queue).toEqual({});
  });

  // what it works around: close() swaps out the onClose that fails them, before the socket reports closing
  it('is needed: closing the client alone leaves them waiting for good', async () => {
    const { client, socket, isSettled } = clientWithRequestInFlight();

    client.close();
    socket.emit('close');
    await flush();

    expect(isSettled()).toBe(false);
  });

  it('does nothing without a client', () => {
    expect(() => closeElectrumClient(undefined)).not.toThrow();
  });
});
