import { validateMnemonic } from '../modules/bip39';
import { isMnemonicWord, isMnemonicWordPrefix } from '../modules/mnemonicWords';

// The recovery-phrase grid as plain data, so the rules for filling and judging it can be tested
// without any inputs on screen.

/** BIP39 phrases run from 12 to 24 words in steps of three. */
export const MIN_PHRASE_WORDS = 12;
export const MAX_PHRASE_WORDS = 24;
const PHRASE_LENGTHS = [12, 15, 18, 21, 24];

/** The grid sizes on offer. A 15, 18 or 21-word phrase goes in the larger one with its end left empty. */
export const GRID_SIZES = [MIN_PHRASE_WORDS, MAX_PHRASE_WORDS] as const;
export type GridSize = (typeof GRID_SIZES)[number];

/**
 * The words entered so far. `words` always holds MAX_PHRASE_WORDS entries and only the first `size`
 * are on screen, so the words past the end survive a switch from 24 to 12 words and back.
 */
export interface PhraseGrid {
  words: string[];
  size: GridSize;
}

export type WordStatus = 'empty' | 'typing' | 'valid' | 'invalid';

/** Why Restore is still off: problems to fix, or notes on what's left to enter. */
export type PhraseNote =
  | { kind: 'unknown_words' }
  | { kind: 'invalid_phrase' }
  | { kind: 'missing_word'; number: number }
  | { kind: 'progress'; entered: number; total: GridSize };

export const emptyGrid = (size: GridSize = MIN_PHRASE_WORDS): PhraseGrid => ({
  words: Array<string>(MAX_PHRASE_WORDS).fill(''),
  size,
});

const gridSizeFor = (wordCount: number): GridSize => (wordCount > MIN_PHRASE_WORDS ? MAX_PHRASE_WORDS : MIN_PHRASE_WORDS);

export const visibleWords = (grid: PhraseGrid): string[] => grid.words.slice(0, grid.size);

export function withWord(grid: PhraseGrid, index: number, word: string): PhraseGrid {
  const words = [...grid.words];
  words[index] = word;
  return { ...grid, words };
}

/**
 * Several words at once, from a paste or a scan. A whole phrase (MIN_PHRASE_WORDS or more) replaces
 * the grid and sizes it to fit. Fewer fill forward from `start`, growing the grid if they run past
 * its end, and `replace` clears the grid first. `next` is the index after the last word placed.
 */
export function placeWords(grid: PhraseGrid, start: number, incoming: string[], replace: boolean): { grid: PhraseGrid; next: number } {
  const wholePhrase = incoming.length >= MIN_PHRASE_WORDS;
  const from = wholePhrase || replace ? 0 : start;
  const base = wholePhrase || replace ? emptyGrid().words : grid.words;
  const size = gridSizeFor(wholePhrase ? incoming.length : Math.max(grid.size, from + incoming.length));
  const placed = incoming.slice(0, MAX_PHRASE_WORDS - from);
  const words = [...base];
  placed.forEach((word, i) => {
    words[from + i] = word;
  });
  return { grid: { words, size }, next: wholePhrase ? size : from + placed.length };
}

/** A half-typed word only counts as wrong once its pill loses focus, or once no word could start that way. */
export function wordStatuses(grid: PhraseGrid, focusedIndex: number | null): WordStatus[] {
  return visibleWords(grid).map((word, index) => {
    if (!word) return 'empty';
    if (isMnemonicWord(word)) return 'valid';
    return index === focusedIndex && isMnemonicWordPrefix(word) ? 'typing' : 'invalid';
  });
}

/**
 * The phrase once the grid holds a valid one, otherwise a note on why not. The phrase runs from the
 * first pill to the first empty one, so a 15, 18 or 21-word phrase can leave the end of the
 * 24-word grid empty.
 */
export function assessPhrase(
  grid: PhraseGrid,
  statuses: WordStatus[],
  focusedIndex: number | null,
): { phrase: string | null; note: PhraseNote | null } {
  const words = visibleWords(grid);
  const firstEmpty = words.indexOf('');
  const end = firstEmpty === -1 ? words.length : firstEmpty;
  const entered = words.slice(0, end);
  const allKnown = entered.every(isMnemonicWord);
  const filled = words.filter(Boolean).length;

  if (filled === end && allKnown && PHRASE_LENGTHS.includes(end) && validateMnemonic(entered.join(' '))) {
    return { phrase: entered.join(' '), note: null };
  }
  if (statuses.includes('invalid')) return { phrase: null, note: { kind: 'unknown_words' } };
  if (end === words.length) {
    // Held back while a pill has focus: finishing the last word passes through shorter words
    // ("act" on the way to "action") that would flash the error at every keystroke.
    return { phrase: null, note: allKnown && focusedIndex === null ? { kind: 'invalid_phrase' } : null };
  }
  if (filled > end) return { phrase: null, note: { kind: 'missing_word', number: end + 1 } };
  if (filled === 0) return { phrase: null, note: null };
  return { phrase: null, note: { kind: 'progress', entered: filled, total: grid.size } };
}
