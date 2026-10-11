/**
 * A fatal JavaScript error crashes the app, and the native crash reporter (Bugsnag, started in
 * MainApplication.kt and AppDelegate.swift) sends its message and stack. Some of the app's errors
 * name a transaction or an address, so strip anything that identifies coins or keys first.
 */

export const REDACTED = '[redacted]';

const PATTERNS: RegExp[] = [
  // Transaction IDs, block hashes and raw keys
  /\b[0-9a-fA-F]{64}\b/g,
  // Bech32 and bech32m addresses, including silent-payment addresses
  /\b(?:bc|tb|bcrt|sp|tsp|sprt)1[02-9ac-hj-np-z]{6,}\b/gi,
  // Extended public and private keys
  /\b[xyzuvt](?:pub|prv)[1-9A-HJ-NP-Za-km-z]{100,}\b/g,
  // Legacy mainnet addresses
  /\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/g,
  // WIF private keys
  /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/g,
];

export function redact(text: string): string {
  return PATTERNS.reduce((result, pattern) => result.replace(pattern, REDACTED), text);
}

export function redactError(error: unknown): unknown {
  if (typeof error === 'string') return redact(error);
  if (!(error instanceof Error)) return error;
  const message = redact(error.message);
  const stack = typeof error.stack === 'string' ? redact(error.stack) : error.stack;
  try {
    error.message = message;
    error.stack = stack;
    return error;
  } catch {
    // A frozen error: report a copy instead.
    const copy = new Error(message);
    copy.name = error.name;
    copy.stack = stack;
    return copy;
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler: () => GlobalHandler; setGlobalHandler: (handler: GlobalHandler) => void };

/** Wraps React Native's global error handler, which hands fatal errors to native code. */
export function installCrashRedaction(errorUtils: ErrorUtilsLike | undefined = (global as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils) {
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => previous(redactError(error), isFatal));
}
