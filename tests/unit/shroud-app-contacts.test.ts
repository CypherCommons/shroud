import assert from 'assert';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ShroudApp } from '../../class/shroud-app';

describe('ShroudApp persistence', () => {
  // Every case builds its own ShroudApp but they all share one `data` key, and the last one
  // encrypts it. Without this, appending or reordering a case fails it for reasons unrelated to
  // its own subject.
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  const ADDR_A = 'sp1qqfqnnv8czppwysafq3uwgwvsc638hc8rx3hscuddh0xa2yd746s7xqh6yy9ncjnqhqxazct0fzh98w7lpkm5fvlepqec2yy0sxlq4j6ccc3h6t0g';

  it('round-trips tx_metadata through storage', async () => {
    const app = new ShroudApp();
    app.tx_metadata = { deadbeef: { memo: 'lunch' } };
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    assert.strictEqual(await reloaded.loadFromDisk(), true);
    assert.deepStrictEqual(reloaded.tx_metadata, { deadbeef: { memo: 'lunch' } });
  });

  it('round-trips contacts through storage', async () => {
    const app = new ShroudApp();
    app.contacts = { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } };
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    assert.strictEqual(await reloaded.loadFromDisk(), true);
    assert.deepStrictEqual(reloaded.contacts, { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } });
  });

  it('starts with an empty contacts map', () => {
    assert.deepStrictEqual(new ShroudApp().contacts, {});
  });

  it('loads a bucket written before contacts existed as an empty map', async () => {
    const app = new ShroudApp();
    // A bucket in the pre-contacts shape, exactly as an existing install has on disk.
    await app.setItem('data', JSON.stringify({ wallets: [], tx_metadata: { abc: { memo: 'x' } } }));

    const reloaded = new ShroudApp();
    assert.strictEqual(await reloaded.loadFromDisk(), true);
    assert.deepStrictEqual(reloaded.contacts, {});
    assert.deepStrictEqual(reloaded.tx_metadata, { abc: { memo: 'x' } });
  });

  it('blanks contacts in the plausible-deniability decoy bucket', async () => {
    const app = new ShroudApp();
    app.contacts = { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } };
    // createFakeStorage appends a decoy bucket to an already-encrypted `data` array, matching
    // how screen/PlausibleDeniability.tsx only reaches this call once storage is encrypted.
    await app.encryptStorage('real-password');

    await app.createFakeStorage('duress-password');

    // In-memory state is cleared...
    assert.deepStrictEqual(app.contacts, {});

    // ...and so is the decoy bucket that the duress password opens.
    const decoy = new ShroudApp();
    assert.strictEqual(await decoy.loadFromDisk('duress-password'), true);
    assert.deepStrictEqual(decoy.contacts, {});
  });

  it('wipeAllData leaves no readable or encrypted data behind, decoy buckets included', async () => {
    const app = new ShroudApp();
    app.contacts = { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } };
    app.tx_metadata = { abc: { memo: 'x' } };
    await app.encryptStorage('real-password');
    await app.createFakeStorage('duress-password');

    await app.wipeAllData();

    const reloaded = new ShroudApp();
    assert.strictEqual(await reloaded.storageIsEncrypted(), false);
    assert.strictEqual(await reloaded.loadFromDisk(), true);
    assert.deepStrictEqual(reloaded.contacts, {});
    assert.deepStrictEqual(reloaded.tx_metadata, {});
    assert.strictEqual(await reloaded.isPasswordInUse('real-password'), false);
    assert.strictEqual(await reloaded.isPasswordInUse('duress-password'), false);
  });
});
