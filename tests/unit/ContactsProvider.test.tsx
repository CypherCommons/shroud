import assert from 'assert';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { bech32m } from 'bech32';

import { ShroudApp } from '../../class';
import { ContactsProvider } from '../../components/Context/ContactsProvider';
import { useContacts } from '../../hooks/context/useContacts';
import { useStorage } from '../../hooks/context/useStorage';
import { setActiveNetwork } from '../../modules/network';

jest.mock('../../hooks/context/useStorage');

const mockUseStorage = useStorage as jest.Mock;
const shroudApp = ShroudApp.getInstance();

const ADDR_A = 'sp1qqfqnnv8czppwysafq3uwgwvsc638hc8rx3hscuddh0xa2yd746s7xqh6yy9ncjnqhqxazct0fzh98w7lpkm5fvlepqec2yy0sxlq4j6ccc3h6t0g';
const ADDR_B = 'sp1qqvchcnrcqpdutxhpf57ptn3wajj0ymqxwzu9g6vj9uxx3wuvlykhyqh99hyh33y5593802pzw5rtw040zrw9f8re52tgcwngc5974w5evuufdy0m';
const TSP_A = bech32m.encode('tsp', bech32m.decode(ADDR_A, 118).words, 130);

describe('ContactsProvider', () => {
  let saveToDisk: jest.Mock;

  beforeEach(() => {
    shroudApp.contacts = {};
    saveToDisk = jest.fn().mockResolvedValue(undefined);
    mockUseStorage.mockReturnValue({ saveToDisk, walletsInitialized: true });
  });

  const renderContacts = () =>
    renderHook(() => useContacts(), { wrapper: ({ children }) => <ContactsProvider>{children}</ContactsProvider> });

  it('syncs from the shroudApp singleton once wallets are initialized', () => {
    shroudApp.contacts = { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } };

    const { result } = renderContacts();

    assert.deepStrictEqual(
      result.current.contactList.map(c => c.address),
      [ADDR_A],
    );
  });

  it('holds off until wallets are initialized, so a half-loaded singleton is not shown', () => {
    shroudApp.contacts = { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } };
    mockUseStorage.mockReturnValue({ saveToDisk, walletsInitialized: false });

    const { result } = renderContacts();

    assert.deepStrictEqual(result.current.contactList, []);
  });

  it('saveContact writes the singleton and forces a save to disk', async () => {
    const { result } = renderContacts();

    await act(async () => {
      await result.current.saveContact({ name: 'Lena Fischer', address: ADDR_B });
    });

    assert.strictEqual(shroudApp.contacts[ADDR_B].name, 'Lena Fischer');
    await waitFor(() =>
      assert.deepStrictEqual(
        result.current.contactList.map(c => c.name),
        ['Lena Fischer'],
      ),
    );
    // force=true, or the unforced path would early-return with no wallets loaded.
    assert.strictEqual(saveToDisk.mock.calls.length, 1);
    assert.strictEqual(saveToDisk.mock.calls[0][0], true);
  });

  it('deleteContact drops it from the singleton and saves', async () => {
    shroudApp.contacts = { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } };
    const { result } = renderContacts();

    await act(async () => {
      await result.current.deleteContact(ADDR_A.toUpperCase());
    });

    assert.deepStrictEqual(shroudApp.contacts, {});
    await waitFor(() => assert.deepStrictEqual(result.current.contactList, []));
    assert.strictEqual(saveToDisk.mock.calls.length, 1);
    assert.strictEqual(saveToDisk.mock.calls[0][0], true);
  });

  it('rejects an invalid contact before touching the singleton or the disk', async () => {
    const { result } = renderContacts();

    await act(async () => {
      await assert.rejects(result.current.saveContact({ name: '', address: 'not-an-address' }));
    });

    assert.deepStrictEqual(shroudApp.contacts, {});
    assert.strictEqual(saveToDisk.mock.calls.length, 0);
  });

  it('validate reports a duplicate without the caller holding the contacts map', async () => {
    shroudApp.contacts = { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } };
    const { result } = renderContacts();

    await waitFor(() => assert.strictEqual(result.current.contactList.length, 1));
    assert.deepStrictEqual(result.current.validate({ name: 'Someone Else', address: ADDR_A }), [
      { field: 'address', code: 'duplicate', conflictName: 'Anmol Sharma' },
    ]);
  });

  it("lists only the active network's contacts and keeps the rest on save", async () => {
    shroudApp.contacts = {
      [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 },
      [TSP_A]: { name: 'Signet Faucet', createdAt: 1000, colorIndex: 1 },
    };
    mockUseStorage.mockReturnValue({ saveToDisk, walletsInitialized: true, activeNetworkId: 'bitcoin' });
    const { result, rerender } = renderContacts();

    assert.deepStrictEqual(
      result.current.contactList.map(c => c.address),
      [ADDR_A],
    );

    await act(async () => {
      await result.current.saveContact({ name: 'Lena Fischer', address: ADDR_B });
    });
    assert.deepStrictEqual(Object.keys(shroudApp.contacts).sort(), [ADDR_A, ADDR_B, TSP_A].sort());

    try {
      setActiveNetwork('signet');
      mockUseStorage.mockReturnValue({ saveToDisk, walletsInitialized: true, activeNetworkId: 'signet' });
      rerender({});

      assert.deepStrictEqual(
        result.current.contactList.map(c => c.address),
        [TSP_A],
      );
    } finally {
      setActiveNetwork('bitcoin');
    }
  });

  it('resetContacts re-syncs from the singleton after it is mutated directly', () => {
    shroudApp.contacts = { [ADDR_A]: { name: 'Anmol Sharma', createdAt: 1000, colorIndex: 2 } };
    const { result } = renderContacts();
    assert.strictEqual(result.current.contactList.length, 1);

    // Simulates createFakeStorage() blanking the singleton when switching to the
    // plausible-deniability decoy bucket, bypassing the provider's own setState.
    shroudApp.contacts = {};

    act(() => {
      result.current.resetContacts();
    });

    assert.deepStrictEqual(result.current.contactList, []);
  });
});
