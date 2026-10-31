import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';

import { ShroudApp } from '../../class';
import {
  ContactError,
  ContactInput,
  ContactListItem,
  TContact,
  TContacts,
  getContact as getContactFrom,
  isValidContactAddress,
  listContacts,
  removeContact,
  upsertContact,
  validateContact,
} from '../../class/contacts';
import { useStorage } from '../../hooks/context/useStorage';

const shroudApp = ShroudApp.getInstance();

export interface ContactsContextType {
  contactList: ContactListItem[];
  getContact: (address: string) => TContact | undefined;
  /** The same check saveContact runs, so a form can preview the verdict without holding the map. */
  validate: (input: ContactInput) => ContactError[];
  saveContact: (input: ContactInput) => Promise<void>;
  deleteContact: (address: string) => Promise<void>;
  resetContacts: () => void;
}

// @ts-ignore default value does not match the type, matching StorageContext's convention
export const ContactsContext = createContext<ContactsContextType>(undefined);

export const ContactsProvider = ({ children }: { children: React.ReactNode }) => {
  const { saveToDisk, walletsInitialized, activeNetworkId } = useStorage();
  const [contacts, setContacts] = useState<TContacts>({});

  // walletsInitialized is the signal that loadFromDisk has finished populating the singleton.
  useEffect(() => {
    if (walletsInitialized) setContacts(shroudApp.contacts);
  }, [walletsInitialized]);

  // No rollback on a failed write: ShroudApp.saveToDisk catches everything it hits and alerts from
  // inside, and StorageProvider hands its body to InteractionManager, which drops the promise.
  // Awaiting it therefore never rejects, so an optimistic-update-and-revert here would be a safety
  // net that cannot fire. Keeping the write one-way at least does not claim otherwise.
  const persist = useCallback(
    async (next: TContacts) => {
      shroudApp.contacts = next;
      setContacts(next);
      // force=true: the unforced path early-returns when no wallets are loaded.
      await saveToDisk(true);
    },
    [saveToDisk],
  );

  // Re-validates rather than trusting the caller, so a form and the provider cannot drift.
  const saveContact = useCallback(async (input: ContactInput) => persist(upsertContact(shroudApp.contacts, input)), [persist]);

  const deleteContact = useCallback(async (address: string) => persist(removeContact(shroudApp.contacts, address)), [persist]);

  // Mirrors StorageProvider's resetWallets(): re-syncs from the shroudApp singleton after an
  // operation that mutates it directly, such as createFakeStorage() switching to the
  // plausible-deniability decoy bucket. Without this, the real contact list would remain in
  // React state — and visible via the Contacts screen — after switching to decoy storage.
  const resetContacts = useCallback(() => {
    setContacts(shroudApp.contacts);
  }, []);

  // The map holds every chain's contacts; only list the ones payable on the active network.
  // activeNetworkId is not read here, but isValidContactAddress depends on it.
  const contactList = useMemo(
    () => listContacts(contacts).filter(c => isValidContactAddress(c.address)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, activeNetworkId],
  );

  const getContact = useCallback((address: string) => getContactFrom(contacts, address), [contacts]);

  const validate = useCallback((input: ContactInput) => validateContact(contacts, input), [contacts]);

  const value: ContactsContextType = useMemo(
    () => ({ contactList, getContact, validate, saveContact, deleteContact, resetContacts }),
    [contactList, getContact, validate, saveContact, deleteContact, resetContacts],
  );

  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
};
