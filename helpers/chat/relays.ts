/**
 * The relay list every Shroud chat user shares. One list means two Shroud users always overlap, with
 * no discovery step. Relays only ever see kinds 30443 (key packages), 445 (group messages, each
 * signed by a fresh throwaway key) and 1059 (gift-wrapped invites): never message content.
 *
 * To add a relay you run (for the demo), call `setChatRelays([...])` with it first; the public relays
 * below keep chat working without it.
 */
export const DEFAULT_CHAT_RELAYS: readonly string[] = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

let configured: string[] = [...DEFAULT_CHAT_RELAYS];

export const isRelayUrl = (url: unknown): url is string =>
  typeof url === 'string' && /^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(url) && url.length <= 200;

/** The relays chat reads from and publishes to. */
export const getChatRelays = (): string[] => [...configured];

/** Replace the shared relay list (e.g. to add the demo relay). Invalid entries are dropped; an empty result restores the defaults. */
export function setChatRelays(relays: readonly string[]): void {
  const cleaned = [...new Set(relays.filter(isRelayUrl))];
  configured = cleaned.length > 0 ? cleaned : [...DEFAULT_CHAT_RELAYS];
}
