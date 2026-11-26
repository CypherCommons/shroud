/**
 * Inner (MLS-wrapped, unsigned) event kinds Shroud chat uses. 8352–8354 are unregistered
 * placeholders; keep every one of them here so a registered number is a one-line change.
 */
export const KIND_CHAT = 9;
export const KIND_PAYMENT_NOTICE = 8352;
export const KIND_PAYMENT_RECEIPT = 8353;
export const KIND_PAYMENT_REQUEST = 8354;

/** Outer Nostr kinds Marmot puts on relays. */
export const KIND_KEY_PACKAGE = 30443;
export const KIND_GROUP_MESSAGE = 445;
export const KIND_GIFT_WRAP = 1059;
export const KIND_RELAY_LIST = 10002;
export const KIND_INBOX_RELAY_LIST = 10050;
