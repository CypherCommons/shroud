import { isSilentPaymentAddress } from '../helpers/silent-payments';
import { getActiveNetwork } from '../modules/network';

export const MAX_CONTACT_NAME_LENGTH = 50;

/** How many distinct colour indices a contact may carry. components/ContactAvatar holds the tints. */
export const CONTACT_COLOR_COUNT = 5;

export type TContact = { name: string; createdAt: number; colorIndex: number };

export type TContacts = { [address: string]: TContact };

export type ContactListItem = TContact & { address: string };

export type ContactInput = { name: string; address: string; editingAddress?: string; colorIndex?: number };

export type ContactError =
  | { field: 'name'; code: 'empty' | 'too_long' }
  | { field: 'address'; code: 'empty' | 'invalid' }
  | { field: 'address'; code: 'duplicate'; conflictName: string };

export class ContactValidationError extends Error {
  readonly errors: ContactError[];

  constructor(errors: ContactError[]) {
    super('Invalid contact');
    this.name = 'ContactValidationError';
    this.errors = errors;
  }
}

/**
 * Silent payment addresses are bech32m, which is case-insensitive: the uppercase form of an
 * address decodes to the same payee. Normalizing before validating, keying and comparing is
 * what keeps the address usable as a primary key.
 */
export const normalizeAddress = (raw: string): string => raw.trim().toLowerCase();

/**
 * The app's one definition of "an address we can pay".
 *
 * A bare bech32m decode accepts any HRP — `tsp1…` and even `lol1…` pass — so the address is
 * checked against the active network's HRP (`sp` on mainnet, `tsp` on the test chains), the same
 * rule the transaction builder routes on (see abstract-hd-electrum-wallet's hasSilentPaymentOutput).
 * Anything else would save, prefill the send screen and then quietly take the non-SP path. Check it
 * here rather than let the two layers disagree about what is payable.
 */
export const isValidContactAddress = (addr: string): boolean => {
  const normalized = normalizeAddress(addr);
  return isSilentPaymentAddress(normalized, getActiveNetwork().bitcoinjs);
};

export const getContact = (contacts: TContacts, address: string): TContact | undefined => contacts[normalizeAddress(address)];

const paletteIndex = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CONTACT_COLOR_COUNT ? value : undefined;

export const randomContactColorIndex = (): number => Math.floor(Math.random() * CONTACT_COLOR_COUNT);

/**
 * Both validate and upsert start by trimming the name and normalizing the addresses. Doing it
 * in one place is what keeps them agreeing on what counts as "the same input".
 */
const normalizeInput = (input: ContactInput): ContactInput => ({
  name: input.name.trim(),
  address: normalizeAddress(input.address),
  editingAddress: input.editingAddress === undefined ? undefined : normalizeAddress(input.editingAddress),
});

export const validateContact = (contacts: TContacts, input: ContactInput): ContactError[] => {
  const errors: ContactError[] = [];
  const { name, address, editingAddress } = normalizeInput(input);

  if (name.length === 0) errors.push({ field: 'name', code: 'empty' });
  else if (name.length > MAX_CONTACT_NAME_LENGTH) errors.push({ field: 'name', code: 'too_long' });

  if (address.length === 0) {
    errors.push({ field: 'address', code: 'empty' });
  } else if (!isValidContactAddress(address)) {
    errors.push({ field: 'address', code: 'invalid' });
  } else {
    // A contact is never a duplicate of itself, or renaming one would report a collision
    // with the very record being edited.
    const conflict = address === editingAddress ? undefined : contacts[address];
    if (conflict) errors.push({ field: 'address', code: 'duplicate', conflictName: conflict.name });
  }

  return errors;
};

export const upsertContact = (contacts: TContacts, input: ContactInput): TContacts => {
  const errors = validateContact(contacts, input);
  if (errors.length > 0) throw new ContactValidationError(errors);

  const { name, address, editingAddress } = normalizeInput(input);
  const next: TContacts = { ...contacts };

  // The address is the primary key, so changing it is a delete-then-insert. createdAt has to
  // travel to the new key or fixing a typo would silently reset the contact's age.
  const previous = editingAddress === undefined ? undefined : next[editingAddress];
  const createdAt = previous?.createdAt ?? Date.now();
  const colorIndex = previous?.colorIndex ?? paletteIndex(input.colorIndex) ?? randomContactColorIndex();
  if (editingAddress !== undefined && editingAddress !== address) delete next[editingAddress];

  next[address] = { name, createdAt, colorIndex };
  return next;
};

export const removeContact = (contacts: TContacts, address: string): TContacts => {
  const next: TContacts = { ...contacts };
  delete next[normalizeAddress(address)];
  return next;
};

export const listContacts = (contacts: TContacts): ContactListItem[] =>
  Object.entries(contacts)
    .map(([address, contact]) => ({ address, ...contact }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

export const searchContacts = (list: ContactListItem[], query: string): ContactListItem[] => {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return list;
  return list.filter(c => c.name.toLowerCase().includes(needle) || c.address.includes(needle));
};

/**
 * Deserializes the `contacts` field of a storage bucket. Buckets written before this feature
 * have no such field, so a missing or malformed value reads as an empty map — that tolerance
 * is the whole migration path for existing installs.
 *
 * The key is the primary key and is validated like any other field: an entry the send flow could
 * not pay is dropped rather than shown as a live contact that upsertContact then refuses to
 * rename.
 */
export const readContacts = (raw: unknown): TContacts => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: TContacts = {};
  for (const [address, value] of Object.entries(raw as Record<string, unknown>)) {
    const record = value as { name?: unknown; createdAt?: unknown; colorIndex?: unknown } | null;
    if (typeof record?.name !== 'string') continue;

    const normalized = normalizeAddress(address);
    if (!isValidContactAddress(normalized)) {
      console.warn('dropping contact with unpayable address');
      continue;
    }
    // Two keys differing only in case are the same payee; keeping the first is arbitrary, but
    // silently overwriting is not something to do without a word.
    if (out[normalized] !== undefined) {
      console.warn('duplicate contact address after normalization, keeping the first');
      continue;
    }

    out[normalized] = {
      name: record.name,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
      colorIndex: paletteIndex(record.colorIndex) ?? randomContactColorIndex(),
    };
  }
  return out;
};
