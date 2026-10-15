import * as bip39 from 'bip39';

export const WORDLISTS: readonly string[][] = [
  bip39.wordlists.english,
  bip39.wordlists.french,
  bip39.wordlists.spanish,
  bip39.wordlists.italian,
  bip39.wordlists.japanese,
  bip39.wordlists.korean,
  bip39.wordlists.chinese_simplified,
  bip39.wordlists.chinese_traditional,
  bip39.wordlists.czech,
  bip39.wordlists.portuguese,
];

export const ALL_WORDS = new Set(WORDLISTS.flat());

/** The wordlist new phrases are written in (English), and the one assumed when nothing says otherwise. */
export const defaultWordlist = (): string[] => bip39.wordlists[bip39.getDefaultWordlist()];

export function validateMnemonic(mnemonic: string) {
  for (const wordlist of WORDLISTS) {
    const valid = bip39.validateMnemonic(mnemonic, wordlist);
    if (valid) return true;
  }
  return false;
}

// Prefixes that uniquely identify one word in the default (English) wordlist. Lazily built
// and memoised on first use rather than eagerly at module load, since this module is imported
// at app boot (via AbstractHDWallet and class/index.ts) whether or not a phrase is ever typed.
let englishPrefixCompletions: Map<string, string> | undefined;
function getEnglishPrefixCompletions(): Map<string, string> {
  if (!englishPrefixCompletions) {
    const completions = new Map<string, string>();
    const ambiguousPrefixes = new Set<string>();

    for (const word of defaultWordlist()) {
      for (const prefix of [word.slice(0, 3), word.slice(0, 4)]) {
        if (ambiguousPrefixes.has(prefix)) continue;
        if (completions.has(prefix)) {
          completions.delete(prefix);
          ambiguousPrefixes.add(prefix);
        } else {
          completions.set(prefix, word);
        }
      }
    }

    englishPrefixCompletions = completions;
  }

  return englishPrefixCompletions;
}

// Strips visible ASCII punctuation plus Unicode whitespace/invisible separators (general
// punctuation block, C0/C1 controls, DEL), leaving wordlist characters (CJK, accented Latin,
// Hangul, etc.) untouched. Not \p{L}/\p{N} (Unicode property escapes): Hermes's regex engine
// has broken support for them (facebook/hermes#850, facebook/hermes#1027). Verified against
// all 10 supported wordlists: no wordlist character falls in the stripped ranges.
// eslint-disable-next-line no-control-regex -- \x00-\x1f/\x7f are intentionally stripped, not accidental
const MNEMONIC_SEPARATOR_PATTERN = /[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xa0\u2000-\u206f]/g;

function cleanMnemonicText(secret: string): string {
  return secret.trim().toLowerCase().replace(MNEMONIC_SEPARATOR_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

// Completes a partial English word only when it isn't already a complete word in some
// supported wordlist — otherwise a short word from another Latin-script wordlist (e.g.
// Spanish "luna") can collide with a unique English prefix and get silently rewritten
// (e.g. to "lunar"), even when only some other word in the phrase has a typo.
function completePartialWords(secret: string): string {
  const prefixCompletions = getEnglishPrefixCompletions();
  return secret
    .split(' ')
    .map(word => (ALL_WORDS.has(word) ? word : prefixCompletions.get(word) || word))
    .join(' ');
}

/**
 * Turns whatever the user entered, pasted or scanned into the phrase a wallet stores: decodes a
 * standard SeedQR, lowercases, turns punctuation and odd whitespace into single spaces, and
 * completes unique English prefixes ("aban" → "abandon").
 */
export function normalizeMnemonic(secret: string): string {
  // first, checking if it's a SeedQR:
  try {
    // compact seedQR should be between 32 - 64 chars long in hex format
    if (secret.length === 64 || secret.length === 32) {
      // not supported as mobile scanners dont recognize such QRs at all.
      // nop
    } else if (secret.length === 96 || secret.length === 48) {
      // standard seedQR
      const wordlist = defaultWordlist();
      const words = secret.match(/[\d]{4}/g);

      if (words) {
        secret = words.map(num => wordlist[parseInt(num, 10)]).join(' ');
      }
    }
  } catch (e) {}
  // end SeedQR

  return completePartialWords(cleanMnemonicText(secret));
}

/** The words of normalizeMnemonic's phrase: what a paste or a scan puts in the pills. */
export function mnemonicWords(text: string): string[] {
  return normalizeMnemonic(text).split(' ').filter(Boolean);
}

/** The words in `text`, split and cleaned like mnemonicWords but with none completed. */
export function mnemonicWordsAsTyped(text: string): string[] {
  return cleanMnemonicText(text).split(' ').filter(Boolean);
}

/** Whether typing `text` ended a word: it holds a space or a character normalizeMnemonic treats as one. */
export function hasWordBreak(text: string): boolean {
  // search(), not test(): test() on a /g regex resumes from the last match's lastIndex.
  return text.search(MNEMONIC_SEPARATOR_PATTERN) !== -1 || /\s/.test(text);
}
