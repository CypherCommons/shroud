import { WORDLISTS, defaultWordlist } from './bip39';

// Word-by-word lookups for entering a recovery phrase: is this a word, could it still become one,
// which words could it become.

// The wordlists store their words NFKD-normalised (decomposed accents, conjoining Hangul jamo),
// while keyboards type composed characters, so lookups compare in the wordlists' form.
const toWordlistForm = (text: string) => text.normalize('NFKD').toLowerCase();

interface WordIndex {
  set: Set<string>;
  // Code-unit order for binary search: bip39 keeps several lists (French, Spanish, Czech, the CJK
  // lists) in their own collation order.
  sorted: string[];
}

// Built on first use per list, since the restore screen is the only thing that needs them.
const indexes = new Map<readonly string[], WordIndex>();
function indexFor(words: readonly string[]): WordIndex {
  let index = indexes.get(words);
  if (!index) {
    index = { set: new Set(words), sorted: [...words].sort() };
    indexes.set(words, index);
  }
  return index;
}

// Every word of every supported list, for the checks that don't care about language.
const EVERY_WORD = WORDLISTS.flat();

function wordsWithPrefix(sorted: string[], prefix: string, limit: number): string[] {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sorted[mid] < prefix) low = mid + 1;
    else high = mid;
  }

  const matches: string[] = [];
  for (let i = low; i < sorted.length && matches.length < limit && sorted[i].startsWith(prefix); i++) {
    matches.push(sorted[i]);
  }
  return matches;
}

// The wordlist most of `phrase` comes from, so suggestions follow the phrase's language. The
// default list until a word from another one shows up, and on a tie.
function wordlistFor(phrase: string[]): readonly string[] {
  const words = phrase.filter(Boolean).map(toWordlistForm);
  let best: readonly string[] = defaultWordlist();
  let bestCount = 0;
  for (const wordlist of WORDLISTS) {
    const { set } = indexFor(wordlist);
    const count = words.filter(word => set.has(word)).length;
    if (count > bestCount) {
      best = wordlist;
      bestCount = count;
    }
  }
  return best;
}

/** Whether `word` is in any supported wordlist. */
export function isMnemonicWord(word: string): boolean {
  return indexFor(EVERY_WORD).set.has(toWordlistForm(word));
}

/** Whether `prefix` can still be typed into a word of some supported wordlist. */
export function isMnemonicWordPrefix(prefix: string): boolean {
  return wordsWithPrefix(indexFor(EVERY_WORD).sorted, toWordlistForm(prefix), 1).length > 0;
}

/** Up to `limit` words starting with `prefix`, in order, from the wordlist the rest of `phrase` uses. */
export function suggestMnemonicWords(prefix: string, phrase: string[], limit: number): string[] {
  const normalized = toWordlistForm(prefix.trim());
  if (!normalized) return [];
  return wordsWithPrefix(indexFor(wordlistFor(phrase)).sorted, normalized, limit);
}

/**
 * The only word `prefix` can become in the wordlist the rest of `phrase` uses, or undefined.
 * Needs three letters, like normalizeMnemonic's English completion, and leaves complete words alone.
 */
export function completeMnemonicWord(prefix: string, phrase: string[]): string | undefined {
  const normalized = toWordlistForm(prefix);
  if (normalized.length < 3 || isMnemonicWord(normalized)) return undefined;
  const matches = wordsWithPrefix(indexFor(wordlistFor(phrase)).sorted, normalized, 2);
  return matches.length === 1 ? matches[0] : undefined;
}
