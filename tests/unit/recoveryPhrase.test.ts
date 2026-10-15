import assert from 'assert';

import { assessPhrase, emptyGrid, PhraseGrid, placeWords, visibleWords, withWord, wordStatuses } from '../../helpers/recoveryPhrase';

const phraseOf = (words: number, last: string) => [...Array(words - 1).fill('abandon'), last];
const PHRASE_12 = phraseOf(12, 'about');
const PHRASE_18 = phraseOf(18, 'agent');
const PHRASE_24 = phraseOf(24, 'art');

const fill = (words: string[], size: 12 | 24 = 12): PhraseGrid => words.reduce((grid, word, i) => withWord(grid, i, word), emptyGrid(size));
const assess = (grid: PhraseGrid, focusedIndex: number | null = null) => assessPhrase(grid, wordStatuses(grid, focusedIndex), focusedIndex);

describe('helpers/recoveryPhrase', () => {
  describe('placeWords', () => {
    it('puts a whole phrase in from the first pill, wherever it was pasted, and sizes the grid to it', () => {
      const { grid, next } = placeWords(fill(['zoo']), 5, PHRASE_24, false);
      assert.deepStrictEqual(visibleWords(grid), PHRASE_24);
      assert.strictEqual(grid.size, 24);
      assert.strictEqual(next, 24);

      assert.strictEqual(placeWords(grid, 0, PHRASE_12, false).grid.size, 12);
    });

    it('fills a few words forward from where they were pasted, leaving the rest alone', () => {
      const { grid, next } = placeWords(fill(['zoo']), 4, ['abandon', 'ability', 'able'], false);
      assert.deepStrictEqual(visibleWords(grid).slice(0, 8), ['zoo', '', '', '', 'abandon', 'ability', 'able', '']);
      assert.strictEqual(next, 7);
    });

    it('grows the grid when the words run past the twelfth pill', () => {
      const { grid, next } = placeWords(emptyGrid(), 10, ['abandon', 'ability', 'able'], false);
      assert.strictEqual(grid.size, 24);
      assert.strictEqual(grid.words[12], 'able');
      assert.strictEqual(next, 13);
    });

    it('clears everything first when asked to replace', () => {
      const { grid } = placeWords(fill(PHRASE_12), 0, ['zoo'], true);
      assert.deepStrictEqual(visibleWords(grid), ['zoo', ...Array(11).fill('')]);
    });
  });

  describe('a smaller grid', () => {
    it('hides the words past its end instead of dropping them', () => {
      const grid24 = fill(PHRASE_24, 24);
      const grid12 = { ...grid24, size: 12 as const };
      assert.deepStrictEqual(visibleWords(grid12), PHRASE_24.slice(0, 12));
      assert.deepStrictEqual(visibleWords({ ...grid12, size: 24 }), PHRASE_24);
      // Only what's on screen counts.
      assert.strictEqual(assess(grid12).phrase, null);
    });
  });

  describe('assessPhrase', () => {
    it('gives the phrase once every word is real and the checksum holds', () => {
      assert.deepStrictEqual(assess(fill(PHRASE_12)), { phrase: PHRASE_12.join(' '), note: null });
    });

    it('accepts an 18-word phrase that leaves the end of the 24-word grid empty', () => {
      assert.strictEqual(assess(fill(PHRASE_18, 24)).phrase, PHRASE_18.join(' '));
    });

    it('says nothing about an empty grid', () => {
      assert.deepStrictEqual(assess(emptyGrid()), { phrase: null, note: null });
    });

    it('counts the words while the grid is still filling up', () => {
      assert.deepStrictEqual(assess(fill(['abandon', 'abandon', 'abandon'])).note, { kind: 'progress', entered: 3, total: 12 });
    });

    it('counts against 24 when a shorter phrase in the big grid fails its checksum', () => {
      assert.deepStrictEqual(assess(fill(phraseOf(18, 'abandon'), 24)).note, { kind: 'progress', entered: 18, total: 24 });
    });

    it('points at the first empty pill when a later one has a word', () => {
      const grid = withWord(fill(PHRASE_12), 5, '');
      assert.deepStrictEqual(assess(grid).note, { kind: 'missing_word', number: 6 });
    });

    it("flags words that aren't on the wordlist before anything else", () => {
      const grid = withWord(withWord(fill(PHRASE_12), 5, ''), 11, 'aboot');
      assert.deepStrictEqual(assess(grid).note, { kind: 'unknown_words' });
    });

    it("leaves a half-typed word alone while its pill has focus, then flags it if it isn't a word", () => {
      const grid = fill(['abandon', 'aba']);
      assert.deepStrictEqual(wordStatuses(grid, 1).slice(0, 2), ['valid', 'typing']);
      assert.deepStrictEqual(wordStatuses(grid, null).slice(0, 2), ['valid', 'invalid']);
      assert.deepStrictEqual(wordStatuses(fill(['poil']), 0)[0], 'invalid');
    });

    it('reports a full grid of real words that fails the checksum, but not while a pill has focus', () => {
      const grid = fill(phraseOf(12, 'abandon'));
      assert.deepStrictEqual(assess(grid).note, { kind: 'invalid_phrase' });
      assert.strictEqual(assess(grid, 11).note, null);
    });
  });
});
